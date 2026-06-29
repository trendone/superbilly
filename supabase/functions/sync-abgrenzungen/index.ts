// ============================================================
// sync-abgrenzungen – Pull-Sync Zoho „Abgrenzungen" → milestones (read-only)
//
// Das Custom-Modul Abgrenzungen liefert die Rechnungs-Splits je Auftrag
// (z. B. „1. Abgrenzung 50%", „Erste Rechnung"). Wir spiegeln sie als
// Rechnungs-Meilensteine in die Projektplanung.
//
// COQL: select … from Abgrenzungen where Beauftragt = true
// Zuordnung zum Projekt: Verkaufschance (→ Deal-ID) == projects.external_id.
// Rechnungsdatum-Regel (an Live-Daten verifiziert): Rechnungsdatum ist nur
// gefüllt, wenn Leistungsmonat ≠ Rechnungsmonat; sonst gilt Monat. Also
//   due_date = Rechnungsdatum ?? Monat.
// Hintergrund: ressourcenplanung/zoho-anbindung.md.
// ============================================================

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const ACCOUNTS = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "accounts.zoho.eu";
const ZOHO_API = Deno.env.get("ZOHO_API_DOMAIN") ?? "www.zohoapis.eu";

interface MilestoneRow {
  project_id: string;
  title: string;
  due_date: string | null;
  amount_eur: number | null;
  invoice_status: string;
  invoice_number: string | null;
  product: string | null;
  external_id: string;
  source: string;
}

// Produktname vereinheitlichen: " / "-Trenner, Mehrfach-Leerzeichen weg.
// "Consulting/ Focus Keynote / 50200" → "Consulting / Focus Keynote / 50200".
const normProduct = (v: unknown): string | null => {
  const name = v && typeof v === "object" && "name" in v ? String((v as Record<string, unknown>).name) : null;
  if (!name) return null;
  return name.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
};

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

async function coql(token: string, baseQuery: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 200) {
    const r = await fetch(`https://${ZOHO_API}/crm/v8/coql`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ select_query: `${baseQuery} limit 200 offset ${offset}` }),
    });
    if (r.status === 204) break;
    if (!r.ok) throw new Error(`COQL ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.data ?? []));
    if (!j.info?.more_records) break;
  }
  return out;
}

const lookupId = (v: unknown): string | null =>
  v && typeof v === "object" && "id" in v ? String((v as Record<string, unknown>).id) : null;

async function sbGet(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` },
  });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function buildRows(token: string): Promise<{ rows: MilestoneRow[]; unmatched: number }> {
  const records = await coql(
    token,
    "select id, Beschreibung, Umsatz, Monat, Rechnungsdatum, Rechnung_gestellt, " +
      "Rechnungsnummer, Produkt, Verkaufschance from Abgrenzungen where Beauftragt = true",
  );

  // Projekt-Map: Deal-ID (external_id) → projects.id
  const projects = await sbGet("projects?select=id,external_id&external_id=not.is.null");
  const byDeal = new Map<string, string>();
  for (const p of projects) byDeal.set(String(p.external_id), p.id as string);

  const rows: MilestoneRow[] = [];
  let unmatched = 0;
  for (const a of records) {
    const dealId = lookupId(a.Verkaufschance);
    const projectId = dealId ? byDeal.get(dealId) : undefined;
    if (!projectId) {
      unmatched++;
      continue;
    }
    const dueDate = (a.Rechnungsdatum as string) ?? (a.Monat as string) ?? null;
    rows.push({
      project_id: projectId,
      title: (a.Beschreibung as string) ?? "(ohne Beschreibung)",
      due_date: dueDate,
      amount_eur: a.Umsatz != null ? Number(a.Umsatz) : null,
      invoice_status: a.Rechnung_gestellt ? "gestellt" : "offen",
      invoice_number: (a.Rechnungsnummer as string) ?? null,
      product: normProduct(a.Produkt),
      external_id: String(a.id),
      source: "zoho",
    });
  }
  return { rows, unmatched };
}

async function upsert(rows: MilestoneRow[]): Promise<void> {
  if (rows.length === 0) return;
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/milestones?on_conflict=external_id`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`milestones upsert ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("SYNC_SECRET");
  if (secret && req.headers.get("x-sync-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const token = await getAccessToken();
    const { rows, unmatched } = await buildRows(token);
    await upsert(rows);
    return new Response(
      JSON.stringify({ ok: true, milestones_upserted: rows.length, unmatched }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
