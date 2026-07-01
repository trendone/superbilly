// ============================================================
// sync-zoho – Pull-Sync Zoho CRM → projects (read-only Spiegelung)
//
// Eine COQL-Abfrage zieht serverseitig gefiltert genau die beauftragten
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
}

interface ProjectUpsertRow extends ProjectRow {
  is_new?: true;
}

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

/** external_ids, die schon in der DB stehen – trennt Insert (neu) von Update (bestehend). */
async function fetchExistingExternalIds(): Promise<Set<string>> {
  const r = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/projects?select=external_id&external_id=not.is.null`,
    {
      headers: {
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
    },
  );
  if (!r.ok) throw new Error(`fetch existing external_ids ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { external_id: string }[];
  return new Set(data.map((d) => d.external_id));
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
    const rows = await buildRows(token);
    const existing = await fetchExistingExternalIds();
    const newRows: ProjectUpsertRow[] = [];
    const updateRows: ProjectUpsertRow[] = [];
    for (const row of rows) {
      if (existing.has(row.external_id)) updateRows.push(row);
      else newRows.push({ ...row, is_new: true });
    }
    await upsertProjects(newRows);
    await upsertProjects(updateRows);
    return new Response(
      JSON.stringify({
        ok: true,
        projects_upserted: rows.length,
        projects_new: newRows.length,
        projects_updated: updateRows.length,
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
