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
//
// Warum COQL: Die Such-API ist bei 2000 Treffern gedeckelt (es gibt >2000
// beauftragte Angebote insgesamt) und kann nicht über die Modulgrenze nach
// Leistungsbereich (am Deal) filtern. COQL macht beides in einem Call
// (Live-Ergebnis 2026-06-29: 175 Zeilen, alle mit Angebotsnummer).
// Hintergrund & Mapping: ressourcenplanung/zoho-anbindung.md §4.
// ============================================================

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const ACCOUNTS = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "accounts.zoho.eu";
const ZOHO_API = Deno.env.get("ZOHO_API_DOMAIN") ?? "www.zohoapis.eu";

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

async function upsertProjects(rows: ProjectRow[]): Promise<void> {
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

Deno.serve(async (req) => {
  // Schutz: nur mit gültigem Sync-Secret (Cron/manuell). verify_jwt=false in config.toml.
  const secret = Deno.env.get("SYNC_SECRET");
  if (secret && req.headers.get("x-sync-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const token = await getAccessToken();
    const rows = await buildRows(token);
    await upsertProjects(rows);
    return new Response(JSON.stringify({ ok: true, projects_upserted: rows.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
