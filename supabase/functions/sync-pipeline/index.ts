// ============================================================
// sync-pipeline – v2.2 Pipeline-Forecast: offene Zoho-Deals → pipeline_deals
//
// Dealgetrieben (anders als sync-zoho, das angebotsgetrieben committed Aufträge
// spiegelt): Stage, Probability und Abschlussdatum hängen am Deal. Eine COQL-
// Abfrage zieht die offenen Consulting-Deals in Verhandlung:
//
//   select id, Deal_Name, Account_Name, Amount, Probability,
//          Closing_Date, Leitungserbringung, Stage
//   from Deals
//   where Stage in ('Angebot verschickt','Angebot nachgefasst','Verhandlungsphase')
//     and Leistungsbereich = 'Consulting'
//
// COQL akzeptiert die deutschen Picklist-Werte direkt (wie Quote_Stage in
// sync-zoho). Volatil → delete-all + insert je Lauf (Muster wie sync-mite):
// verlässt ein Deal die zwei Stages, verschwindet er aus der Pipeline.
// Read-only im Client; Schutz per x-sync-secret (Cron) ODER User-JWT (Browser).
// Hintergrund: docs/konzept.md §4.4 (Killer-Feature Pipeline-Forecast).
// ============================================================

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const ACCOUNTS = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "accounts.zoho.eu";
const ZOHO_API = Deno.env.get("ZOHO_API_DOMAIN") ?? "www.zohoapis.eu";

interface DealRow {
  external_id: string;
  name: string;
  client: string | null;
  stage: string | null;
  probability: number | null;
  amount_eur: number | null;
  closing_date: string | null;
  service_date: string | null;
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

async function buildRows(token: string): Promise<DealRow[]> {
  const records = await coql(
    token,
    "select id, Deal_Name, Account_Name, Amount, Probability, " +
      "Closing_Date, Leitungserbringung, Stage from Deals " +
      "where Stage in ('Angebot verschickt','Angebot nachgefasst','Verhandlungsphase') " +
      "and Leistungsbereich = 'Consulting'",
  );

  const byExternal = new Map<string, DealRow>();
  for (const d of records) {
    const id = d.id != null ? String(d.id) : null;
    if (!id) continue;
    byExternal.set(id, {
      external_id: id,
      name: (d.Deal_Name as string) ?? "Unbenannt",
      client: lookupName(d.Account_Name),
      stage: (d.Stage as string) ?? null,
      probability: d.Probability != null ? Number(d.Probability) : null,
      amount_eur: d.Amount != null ? Number(d.Amount) : null,
      closing_date: (d.Closing_Date as string) ?? null,
      service_date: (d.Leitungserbringung as string) ?? null,
      source: "zoho",
    });
  }
  return [...byExternal.values()];
}

// delete-all + insert (source='zoho'): die Pipeline soll bei jedem Lauf exakt den
// aktuellen Stand der zwei Stages abbilden; herausgefallene Deals verschwinden.
async function replaceAll(rows: DealRow[]): Promise<void> {
  const del = await fetch(`${env("SUPABASE_URL")}/rest/v1/pipeline_deals?source=eq.zoho`, {
    method: "DELETE",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      Prefer: "return=minimal",
    },
  });
  if (!del.ok) throw new Error(`pipeline_deals delete ${del.status}: ${await del.text()}`);
  if (rows.length === 0) return;
  const ins = await fetch(`${env("SUPABASE_URL")}/rest/v1/pipeline_deals`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error(`pipeline_deals insert ${ins.status}: ${await ins.text()}`);
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Schutz: gültiges Sync-Secret (Cron) ODER eingeloggter App-User (manueller Trigger).
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
    await replaceAll(rows);
    return new Response(JSON.stringify({ ok: true, deals_synced: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
