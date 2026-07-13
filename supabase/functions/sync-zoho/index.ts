// ============================================================
// sync-zoho – Pull-Sync Zoho CRM → projects (read-only Spiegelung)
//
// Zwei COQL-Abfragen bilden den gesamten Deal-Lebenszyklus in projects ab:
//  1) beauftragte Consulting-Angebote (Quotes) → status 'aktiv' (buchbar, regulär)
//  2) offene Consulting-Deals (Stage 'Angebot verschickt'/'Angebot nachgefasst'/'Verhandlungsphase')
//     → status 'angebot'/'verhandlung' = vorgemerkte Ressource (buchbar, aber
//     nicht auslastungswirksam; im Raster schraffiert).
// Beide nutzen die Deal-ID als external_id → der Übergang Reservierung →
// beauftragt läuft automatisch über on_conflict=external_id (Status wird auf
// 'aktiv' gehoben, die reservierten Buchungen zählen ab dann normal). Fällt ein
// Deal aus beiden Stages ohne Beauftragung, wird das Projekt auf 'verloren'
// gesetzt und verschwindet aus der Planung (Buchungen bleiben erhalten).
//
// Die erste Abfrage zieht serverseitig gefiltert die beauftragten
// Consulting-Angebote samt zugehöriger Deal-Felder:
//
//   select Angebotsnummer, Sub_Total, Quote_Stage, Deal_Name,
//          Deal_Name.Account_Name, Deal_Name.Leitungserbringung
//   from Quotes
//   where Quote_Stage in ('Beauftragt','Teilweise beauftragt')
//     and Deal_Name.Leistungsbereich = 'Consulting'
//   Leistungsdatum >= ZOHO_SINCE (Default 2025-10-01) wird clientseitig gefiltert
//   (COQL erlaubt keinen Range-Vergleich auf verknüpften Feldern).
//
// Warum COQL: Die Such-API ist bei 2000 Treffern gedeckelt (es gibt >2000
// beauftragte Angebote insgesamt) und kann nicht über die Modulgrenze nach
// Leistungsbereich (am Deal) filtern. COQL macht beides in einem Call
// (Live-Ergebnis 2026-06-29: 175 Zeilen, alle mit Angebotsnummer).
// Hintergrund & Mapping: docs/zoho-anbindung.md §4.
// ============================================================

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const ACCOUNTS = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "accounts.zoho.eu";
const ZOHO_API = Deno.env.get("ZOHO_API_DOMAIN") ?? "www.zohoapis.eu";
// Nur Projekte ab diesem Leistungsdatum importieren (ältere = Altbestand).
const SINCE = Deno.env.get("ZOHO_SINCE") ?? "2025-10-01";

interface ProjectRow {
  external_id: string;
  name: string;
  client: string | null;
  end_date: string | null;
  budget_eur: number | null;
  offer_number: string | null;
  status: string;
  source: string;
  probability?: number | null;
}

interface ProjectUpsertRow extends ProjectRow {
  is_new?: true;
}

// Reservierungs-Status (aus offenen Deal-Stages). Muss mit RESERVED_STATES in
// src/lib/analytics.ts übereinstimmen.
const RESERVED_STATES = new Set(["angebot", "verhandlung"]);

// Zoho-Deal-Stage → Projekt-Status für vorgemerkte Ressourcen.
const stageToStatus = (stage: string | null): string =>
  stage === "Verhandlungsphase" ? "verhandlung" : "angebot";

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: env("ZOHO_REFRESH_TOKEN"),
    client_id: env("ZOHO_CLIENT_ID"),
    client_secret: env("ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const r = await fetch(`https://${ACCOUNTS}/oauth/v2/token`, { method: "POST", body });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

// COQL, paginiert (max. 200/Seite über limit/offset).
async function coql(token: string, baseQuery: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 200) {
    const r = await fetch(`https://${ZOHO_API}/crm/v8/coql`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ select_query: `${baseQuery} limit 200 offset ${offset}` }),
    });
    if (r.status === 204) break; // keine (weiteren) Zeilen
    if (!r.ok) throw new Error(`COQL ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.data ?? []));
    if (!j.info?.more_records) break;
  }
  return out;
}

const lookupName = (v: unknown): string | null =>
  v && typeof v === "object" && "name" in v ? String((v as Record<string, unknown>).name) : null;
const lookupId = (v: unknown): string | null =>
  v && typeof v === "object" && "id" in v ? String((v as Record<string, unknown>).id) : null;

async function buildRows(token: string): Promise<ProjectRow[]> {
  const records = await coql(
    token,
    "select Angebotsnummer, Sub_Total, Quote_Stage, Deal_Name, " +
      "Deal_Name.Account_Name, Deal_Name.Leitungserbringung from Quotes " +
      "where Quote_Stage in ('Beauftragt','Teilweise beauftragt') " +
      "and Deal_Name.Leistungsbereich = 'Consulting'",
  );

  // Dedup über Deal-ID (external_id). 1 Deal = 1 Angebot ist bestätigt;
  // bei mehreren Angeboten zum selben Deal gewinnt das zuletzt gelesene.
  const byExternal = new Map<string, ProjectRow>();
  for (const q of records) {
    const dealId = lookupId(q.Deal_Name);
    if (!dealId) continue;
    // Datumsfilter clientseitig (COQL kann keinen Range auf verknüpften Feldern):
    // nur Projekte ab SINCE; ohne Leistungsdatum = Altbestand → überspringen.
    const ed = q["Deal_Name.Leitungserbringung"] as string | null;
    if (!ed || ed < SINCE) continue;
    byExternal.set(dealId, {
      external_id: dealId,
      name: lookupName(q.Deal_Name) ?? (q.Angebotsnummer as string) ?? "Unbenannt",
      client: lookupName(q["Deal_Name.Account_Name"]),
      end_date: (q["Deal_Name.Leitungserbringung"] as string) ?? null,
      budget_eur: q.Sub_Total != null ? Number(q.Sub_Total) : null,
      offer_number: (q.Angebotsnummer as string) ?? null,
      status: "aktiv",
      source: "zoho",
      // immer gesetzt (null), damit beauftragte + reservierte Zeilen dasselbe
      // Key-Set haben – sonst kippt der PostgREST-Bulk-Upsert mit PGRST102
      // "All object keys must match", sobald beide Formen in einem Batch landen.
      probability: null,
    });
  }
  return [...byExternal.values()];
}

// Offene Consulting-Deals (Stage "Angebot verschickt" / "Angebot nachgefasst" /
// "Verhandlungsphase") als
// vorgemerkte Ressourcen. Dealgetrieben (wie sync-pipeline), external_id = Deal-ID
// – gleicher Schlüssel wie buildRows, daher matcht der spätere Übergang
// Reservierung → beauftragt automatisch über on_conflict=external_id.
async function buildReservationRows(token: string): Promise<ProjectRow[]> {
  const records = await coql(
    token,
    "select id, Deal_Name, Account_Name, Amount, Probability, " +
      "Closing_Date, Leitungserbringung, Stage from Deals " +
      "where Stage in ('Angebot verschickt','Angebot nachgefasst','Verhandlungsphase') " +
      "and Leistungsbereich = 'Consulting'",
  );

  const byExternal = new Map<string, ProjectRow>();
  for (const d of records) {
    const id = d.id != null ? String(d.id) : null;
    if (!id) continue;
    // Datumsregel wie bei beauftragt, aber tolerant: Deals ohne Leistungsdatum
    // sind vorwärtsgerichtete Pipeline und bleiben; nur klar vergangene fliegen raus.
    const ed = (d.Leitungserbringung as string | null) ?? null;
    if (ed && ed < SINCE) continue;
    byExternal.set(id, {
      external_id: id,
      name: (d.Deal_Name as string) ?? "Unbenannt",
      client: lookupName(d.Account_Name),
      end_date: ed,
      budget_eur: d.Amount != null ? Number(d.Amount) : null,
      offer_number: null,
      status: stageToStatus((d.Stage as string) ?? null),
      source: "zoho",
      probability: d.Probability != null ? Number(d.Probability) : null,
    });
  }
  return [...byExternal.values()];
}

async function upsertProjects(rows: ProjectUpsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/projects?on_conflict=external_id`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`projects upsert ${r.status}: ${await r.text()}`);
}

/** external_id → status aller gespiegelten Zoho-Projekte. Trennt Insert (neu) von
 *  Update (bestehend) und liefert den Status für Präzedenz- und Verloren-Logik. */
async function fetchExistingZohoProjects(): Promise<Map<string, string>> {
  const r = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/projects?select=external_id,status&source=eq.zoho&external_id=not.is.null`,
    {
      headers: {
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
    },
  );
  if (!r.ok) throw new Error(`fetch existing projects ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { external_id: string; status: string }[];
  return new Map(data.map((d) => [d.external_id, d.status]));
}

/** Setzt vorgemerkte Projekte, deren Deal nicht mehr offen (und nicht beauftragt)
 *  ist, auf 'verloren'. Buchungen bleiben erhalten; sie verschwinden nur aus der
 *  Planung, bis der Deal ggf. reaktiviert wird. */
async function markLost(externalIds: string[]): Promise<void> {
  if (externalIds.length === 0) return;
  const list = externalIds.map((id) => `"${id}"`).join(",");
  const r = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/projects?source=eq.zoho&external_id=in.(${list})`,
    {
      method: "PATCH",
      headers: {
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "verloren" }),
    },
  );
  if (!r.ok) throw new Error(`projects mark lost ${r.status}: ${await r.text()}`);
}

/** Manueller Trigger aus der App: gültige Session eines eingeloggten (@trendone.com) Users. */
async function isAuthenticatedUser(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: env("SUPABASE_ANON_KEY") },
  });
  return r.ok;
}

// CORS: nötig, seit die App den Sync auch per Klick (Browser) auslösen kann
// (zuvor nur Cron/Server-zu-Server, kein Preflight nötig).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Schutz: gültiges Sync-Secret (Cron) ODER eingeloggter App-User (manueller Trigger).
  // verify_jwt=false in config.toml, daher hier selbst geprüft.
  const secret = Deno.env.get("SYNC_SECRET");
  const bySecret = !!secret && req.headers.get("x-sync-secret") === secret;
  if (!bySecret && !(await isAuthenticatedUser(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const token = await getAccessToken();
    const committed = await buildRows(token); // beauftragt → status 'aktiv'
    const reservationsAll = await buildReservationRows(token); // offen → 'angebot'/'verhandlung'
    const existing = await fetchExistingZohoProjects(); // external_id → status

    // Präzedenz: taucht dieselbe Deal-ID beauftragt UND offen auf, gewinnt
    // beauftragt. Bestehende committete Projekte werden nie zur Reservierung
    // herabgestuft (nur neue oder bereits reservierte dürfen Reservierung sein).
    const committedIds = new Set(committed.map((r) => r.external_id));
    const reservations = reservationsAll.filter((r) => {
      if (committedIds.has(r.external_id)) return false;
      const st = existing.get(r.external_id);
      return st === undefined || RESERVED_STATES.has(st);
    });

    const rows = [...committed, ...reservations];
    const newRows: ProjectUpsertRow[] = [];
    const updateRows: ProjectUpsertRow[] = [];
    for (const row of rows) {
      if (existing.has(row.external_id)) updateRows.push(row);
      else newRows.push({ ...row, is_new: true });
    }
    await upsertProjects(newRows);
    await upsertProjects(updateRows);

    // Verloren: bislang reservierte Projekte, die in diesem Lauf weder offen noch
    // beauftragt gesehen wurden.
    const seen = new Set(rows.map((r) => r.external_id));
    const lost = [...existing.entries()]
      .filter(([id, st]) => RESERVED_STATES.has(st) && !seen.has(id))
      .map(([id]) => id);
    await markLost(lost);

    return new Response(
      JSON.stringify({
        ok: true,
        projects_upserted: rows.length,
        projects_new: newRows.length,
        projects_updated: updateRows.length,
        reservations_synced: reservations.length,
        reservations_lost: lost.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
