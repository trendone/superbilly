// ============================================================
// sync-mite – Pull-Sync Mite Ist-Zeiten → project_actuals (read-only)
//
// Ein gruppierter Report (project,month,service) liefert die Ist-Zeiten.
// Zuordnung Mite-Projekt → unser Projekt:
//   1. project_external_map (bestätigte Ausnahme) — override.
//   2. Angebotsnummer aus dem Mite-Projektnamen (^A - <nr>) ↔ projects.offer_number.
// Unauflösbare bleiben ungemappt (im Response gelistet → Kandidaten fürs Mapping-UI).
//
// Hinweise (an Live-Daten verifiziert 2026-06-29):
//   - Mite-`revenue` ist in CENT → /100.
//   - Header X-MiteApiKey wird case-sensitiv geprüft; Deno/fetch sendet klein →
//     wir nutzen den Query-Param ?api_key=… (robust).
// Hintergrund: docs/konzept.md §3.7/§4.5.
// ============================================================

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const MITE_ACCOUNT = () => env("MITE_ACCOUNT");
const MITE_KEY = () => env("MITE_API_KEY");
const PERIOD = Deno.env.get("MITE_PERIOD") ?? "this_year"; // this_year | last_year | …
const SB_URL = () => env("SUPABASE_URL");
const SB_KEY = () => env("SUPABASE_SERVICE_ROLE_KEY");

interface ActualRow {
  project_id: string;
  source: string;
  period: string;
  service_code: string;
  service_name: string | null;
  minutes: number;
  revenue_eur: number | null;
}

async function miteReport(): Promise<Record<string, unknown>[]> {
  const url = `https://${MITE_ACCOUNT()}.mite.de/time_entries.json` +
    `?group_by=project,month,service&at=${PERIOD}&api_key=${MITE_KEY()}`;
  const r = await fetch(url, { headers: { "User-Agent": "superbilly-sync-mite/1.0" } });
  if (!r.ok) throw new Error(`Mite report ${r.status}: ${await r.text()}`);
  const arr = (await r.json()) as Record<string, unknown>[];
  return arr.map((g) => g.time_entry_group as Record<string, unknown>);
}

async function sbGet(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
  });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${await r.text()}`);
  return await r.json();
}

const digits = (s: unknown): string | null => {
  const m = String(s ?? "").match(/(\d{3,})/);
  return m ? m[1] : null;
};
const leadingOfferNo = (name: unknown): string | null => {
  const m = String(name ?? "").match(/^\s*A\s*-\s*(\d{3,})/);
  return m ? m[1] : null;
};

async function buildRows(): Promise<{ rows: ActualRow[]; unmatched: string[] }> {
  const groups = await miteReport();

  // Resolver-Quellen
  const projects = await sbGet("projects?select=id,offer_number&offer_number=not.is.null");
  const numToProject = new Map<string, string>();
  for (const p of projects) {
    const n = digits(p.offer_number);
    if (n) numToProject.set(n, p.id as string);
  }
  const overrides = await sbGet("project_external_map?select=external_id,project_id&source=eq.mite");
  const overrideMap = new Map<string, string>();
  for (const o of overrides) overrideMap.set(String(o.external_id), o.project_id as string);

  // Aggregation über (project_id, period, service_code) – mehrere Mite-Projekte
  // können auf dasselbe Projekt zeigen.
  const agg = new Map<string, ActualRow>();
  const unmatched = new Set<string>();

  for (const e of groups) {
    const miteId = String(e.project_id);
    const projectId = overrideMap.get(miteId) ??
      numToProject.get(leadingOfferNo(e.project_name) ?? "");
    if (!projectId) {
      unmatched.add(`${miteId} | ${String(e.project_name).trim()}`);
      continue;
    }
    const period = `${String(e.month).slice(0, 4)}-${String(e.month).slice(4, 6)}-01`;
    const serviceCode = e.service_id != null ? String(e.service_id) : "";
    const key = `${projectId}|${period}|${serviceCode}`;
    const minutes = Number(e.minutes ?? 0);
    const revenue = e.revenue != null ? Number(e.revenue) / 100 : null;

    const prev = agg.get(key);
    if (prev) {
      prev.minutes += minutes;
      if (revenue != null) prev.revenue_eur = (prev.revenue_eur ?? 0) + revenue;
    } else {
      agg.set(key, {
        project_id: projectId,
        source: "mite",
        period,
        service_code: serviceCode,
        service_name: (e.service_name as string) ?? null,
        minutes,
        revenue_eur: revenue,
      });
    }
  }
  return { rows: [...agg.values()], unmatched: [...unmatched] };
}

async function upsert(rows: ActualRow[]): Promise<void> {
  if (rows.length === 0) return;
  const r = await fetch(
    `${SB_URL()}/rest/v1/project_actuals?on_conflict=project_id,source,period,service_code`,
    {
      method: "POST",
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!r.ok) throw new Error(`project_actuals upsert ${r.status}: ${await r.text()}`);
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
    const { rows, unmatched } = await buildRows();
    await upsert(rows);
    return new Response(
      JSON.stringify({ ok: true, period: PERIOD, actuals_upserted: rows.length, unmatched }),
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
