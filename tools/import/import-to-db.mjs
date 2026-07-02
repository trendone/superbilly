// ============================================================
// superbilly – Excel-Import-Writer (Billy-Liste -> Supabase)
// Kombiniert import-data.js (vollständige Buchungen) + match-map.json (Projekt-
// Zuordnung) und erzeugt IDEMPOTENTES SQL (Upserts), das transaktional angewandt wird.
//
//  • Mitarbeiter: Insert-wenn-nicht-vorhanden (Dedup über Name; Excel hat keine Mail).
//  • Projekte:    SICHER/SPLIT -> bestehenden Zoho-Eintrag referenzieren (external_id).
//                 UNSICHER/KEIN -> neues source='excel'-Projekt (external_id 'excel:<key>').
//                 System (Urlaub/Krank/Frei/Kurzarbeit/Admin) -> bestehende is_system-Projekte.
//                 Feiertag/Müll -> übersprungen.
//  • Buchungen:   je Excel-Task; Kombis anteilig je Kunde; Budget auf {0.5,1} normalisiert
//                 (App-Modell halber/ganzer Tag). Deterministischer external_id + source='excel'
//                 => Re-Import/Delta = Upsert über uq_bookings_external_id.
//
// Aufruf:  node tools/import/import-to-db.mjs             (nur SQL schreiben -> reports/import.sql)
//          node tools/import/import-to-db.mjs --apply     (SQL schreiben UND via psql anwenden)
//          node tools/import/import-to-db.mjs --prune      (zusätzlich Excel-Waisen im importierten
//                                                           Zeitraum löschen -> echter Snapshot-Sync)
//          (--apply braucht SUPABASE_DB_URL im Env; vorher `set -a; . ./.secrets; set +a`)
//
// --prune: für den Parallelbetrieb mit Google Docs. Ohne prune ist der Import rein additiv
//   (verschobene/umgewidmete/gelöschte Einträge hinterlassen Waisen, weil external_id
//   inhaltsbasiert ist). Mit --prune werden alle source='excel'-Buchungen INNERHALB des
//   importierten Datumsbereichs gelöscht, die im aktuellen Lauf NICHT mehr vorkommen –
//   damit spiegelt Supabase exakt den aktuellen Google-Docs-Stand. App-native (source<>'excel')
//   und Zoho-Daten bleiben unberührt.
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const excelSrc = resolve(__dirname, 'import-data.js')
const mapSrc = resolve(__dirname, 'reports/match-map.json')
const sqlOut = resolve(__dirname, 'reports/import.sql')
const apply = process.argv.includes('--apply')
const prune = process.argv.includes('--prune')

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
const normName = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
// Budget auf das App-Modell zwingen: Kombi-Anteil = halber Tag, sonst halb/ganz runden.
const normBudget = (b, nParts) => (nParts > 1 ? 0.5 : b >= 0.75 ? 1 : 0.5)

// Datums-Tie-Breaker (wie im Matcher): Buchung -> nächster *kommender* Leistungstermin.
const DAY = 86400000
const toD = (s) => new Date(s + 'T00:00:00Z')
const gap = (book, leist) => {
  const diff = (toD(leist).getTime() - toD(book).getTime()) / DAY
  return diff >= 0 ? diff : -diff * 3
}

const mod = await import(pathToFileURL(excelSrc).href)
const data = mod.IMPORT_DATA ?? mod.default
const map = JSON.parse(readFileSync(mapSrc, 'utf8'))
const decisions = new Map(map.decisions.map((d) => [d.key, d]))
const dispo = map.projectDispositions
const empById = Object.fromEntries(data.employees.map((e) => [e.id, e]))
const projName = Object.fromEntries(data.projects.map((p) => [p.id, p.name.replace(/\s+/g, ' ').trim()]))
const slugExt = (s) => 'excel:' + s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim().replace(/\s+/g, '-')
const extraExcel = new Map() // interne Kombis (kein Zoho-Teil) -> ein Excel-Projekt

// ---- Zielprojekt eines Kandidaten-Keys auflösen ----
// Liefert {ext} (über external_id) für Zoho/Excel-Projekte oder wählt bei SPLIT den
// Deal nach Buchungsdatum. stable = stabiler Schlüsselteil für die Buchungs-ID.
// Hinweis: match-map `zohoId` ist die Supabase-projects.id (UUID), nicht die
// Zoho-external_id -> direkt als project_id referenzierbar.
function resolveTarget(key, bookingStart) {
  const d = decisions.get(key)
  if (!d) return null
  if (d.system) return { sys: d.system, stable: 'sys:' + d.system } // interne Kombi-Teile -> System (blau)
  if (d.verdict === 'SICHER') return { pid: d.match.zohoId, stable: 'zoho:' + d.match.zohoId }
  if (d.verdict === 'SPLIT') {
    let best = d.split[0]
    for (const s of d.split) if (gap(bookingStart, s.date) < gap(bookingStart, best.date)) best = s
    return { pid: best.zohoId, stable: 'zoho:' + best.zohoId }
  }
  // UNSICHER / KEIN -> eigenes Excel-Projekt
  return { ext: 'excel:' + key, stable: 'excel:' + key }
}

// ---- Excel-Only-Projekte sammeln (UNSICHER + KEIN, aber NICHT die auf System gerouteten) ----
// d.system-Entscheidungen (interne Kombi-Teile wie "Sales" in "Sales / KPMG") gehen auf die
// is_system-Kategorie -> keine graue Excel-Projekt-Hülle anlegen.
const excelProjects = map.decisions
  .filter((d) => (d.verdict === 'UNSICHER' || d.verdict === 'KEIN') && !d.system)
  .map((d) => ({ ext: 'excel:' + d.key, name: d.display }))

// ---- Buchungen bauen ----
const bookings = new Map() // external_id -> row (dedupe)
const stats = { project: 0, system: 0, split: 0, combo: 0, internalCombo: 0, skip: 0, unknown: 0 }
for (const t of data.tasks) {
  const emp = empById[t.employeeId]
  if (!emp) { stats.unknown++; continue }
  const empKey = normName(emp.name)
  const disp = dispo[t.projectId]
  if (!disp || disp.type === 'skip') { stats.skip++; continue }

  const add = (target, budget, isSystem) => {
    if (!target) { stats.unknown++; return }
    const extId = `billy:${empKey}:${t.startDate}:${t.endDate}:${target.stable ?? 'sys:' + target.sys}`
    bookings.set(extId, {
      empName: emp.name,
      proj: isSystem ? { sys: target.sys } : target.pid ? { pid: target.pid } : { ext: target.ext },
      start: t.startDate, end: t.endDate, budget, extId,
    })
  }

  if (disp.type === 'system') {
    add({ sys: disp.target, stable: 'sys:' + disp.target }, normBudget(t.budget, 1), true)
    stats.system++
  } else if (disp.type === 'project') {
    const parts = disp.parts
    const anyZoho = parts.some((p) => {
      const v = decisions.get(p.key)?.verdict
      return v === 'SICHER' || v === 'SPLIT'
    })
    const anySystem = parts.some((p) => decisions.get(p.key)?.system)
    if (parts.length > 1 && !anyZoho && !anySystem) {
      // reine interne Kombi ohne Zoho-/System-Treffer -> nicht splitten, ein Excel-Projekt
      const name = projName[t.projectId]
      const ext = slugExt(name)
      extraExcel.set(ext, name)
      add({ ext, stable: ext }, normBudget(t.budget, 1), false)
      stats.internalCombo++
    } else {
      if (parts.length > 1) stats.combo++
      for (const { key } of parts) {
        const target = resolveTarget(key, t.startDate)
        if (target && decisions.get(key)?.verdict === 'SPLIT') stats.split++
        add(target, normBudget(t.budget, parts.length), !!target?.sys)
      }
    }
    stats.project++
  } else stats.unknown++
}

// ---- SQL erzeugen ----
const L = []
L.push('-- Generiert von tools/import/import-to-db.mjs – idempotent, transaktional.')
L.push('-- Quelle: ' + excelSrc)
L.push('begin;')

L.push('\n-- 1) Mitarbeiter (Dedup über Name)')
for (const e of data.employees) {
  L.push(
    `insert into employees (name, weekly_hours, active) ` +
    `select ${q(e.name)}, ${e.weeklyHours ?? 40}, true ` +
    `where not exists (select 1 from employees where name = ${q(e.name)});`
  )
}

L.push('\n-- 2) Excel-Only-Projekte (UNSICHER/KEIN ohne Zoho-Deal + interne Kombis)')
const allExcel = [...excelProjects, ...[...extraExcel].map(([ext, name]) => ({ ext, name }))]
for (const p of allExcel) {
  L.push(
    `insert into projects (name, color, status, source, external_id) ` +
    `values (${q(p.name)}, '#94a3b8', 'aktiv', 'excel', ${q(p.ext)}) ` +
    `on conflict (external_id) do update set name = excluded.name, source = 'excel';`
  )
}

L.push(`\n-- 3) Buchungen (${bookings.size}) – Upsert über external_id`)
const projExpr = (proj) =>
  proj.sys
    ? `(select id from projects where name = ${q(proj.sys)} and is_system limit 1)`
    : proj.pid
    ? q(proj.pid)
    : `(select id from projects where external_id = ${q(proj.ext)} limit 1)`
const rows = [...bookings.values()].map(
  (b) =>
    `(${projExpr(b.proj)}, (select id from employees where name = ${q(b.empName)} limit 1), ` +
    `${q(b.start)}, ${q(b.end)}, ${b.budget}, 'excel', ${q(b.extId)})`
)
L.push(
  'insert into bookings (project_id, employee_id, start_date, end_date, budget, source, external_id) values'
)
L.push(rows.join(',\n'))
L.push(
  'on conflict (external_id) where external_id is not null do update set ' +
  'project_id = excluded.project_id, employee_id = excluded.employee_id, ' +
  'start_date = excluded.start_date, end_date = excluded.end_date, budget = excluded.budget;'
)

// ---- 4) Prune: Excel-Waisen im importierten Zeitraum entfernen (nur mit --prune) ----
// Scope = [min(start) .. max(end)] der aktuell importierten Buchungen (aktuell nur 2026-Tabs).
// Löscht source='excel'-Buchungen in diesem Fenster, deren external_id NICHT im aktuellen Lauf
// vorkommt -> verschobene/umgewidmete/gelöschte Google-Docs-Einträge verschwinden. App-native
// (source<>'excel') und Zoho-Projekte bleiben unberührt (Filter auf source='excel').
let pruneRange = null
if (prune) {
  if (bookings.size === 0) {
    L.push('\n-- 4) Prune übersprungen: keine Buchungen im aktuellen Lauf (Schutz vor Totallöschung).')
  } else {
    const starts = [...bookings.values()].map((b) => b.start)
    const ends = [...bookings.values()].map((b) => b.end)
    const minStart = starts.reduce((a, b) => (a < b ? a : b))
    const maxEnd = ends.reduce((a, b) => (a > b ? a : b))
    pruneRange = { minStart, maxEnd }
    const ids = [...bookings.keys()].map(q).join(', ')
    L.push(`\n-- 4) Prune Excel-Waisen im Fenster ${minStart} .. ${maxEnd} (${bookings.size} aktuelle IDs)`)
    L.push(
      `delete from bookings where source = 'excel' ` +
      `and start_date between ${q(minStart)} and ${q(maxEnd)} ` +
      `and external_id <> all (array[${ids}]);`
    )
  }
}

L.push('\ncommit;')
writeFileSync(sqlOut, L.join('\n') + '\n')

console.log('SQL geschrieben:', sqlOut)
console.log(
  `Mitarbeiter ${data.employees.length} · Excel-Projekte ${excelProjects.length + extraExcel.size} ` +
  `(davon interne Kombis ${extraExcel.size}) · Buchungen ${bookings.size}`
)
console.log('Tasks:', JSON.stringify(stats))
if (prune)
  console.log(
    pruneRange
      ? `Prune AKTIV: Excel-Waisen im Fenster ${pruneRange.minStart} .. ${pruneRange.maxEnd} werden gelöscht.`
      : 'Prune angefragt, aber übersprungen (keine Buchungen im Lauf).'
  )

if (apply) {
  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) { console.error('SUPABASE_DB_URL fehlt im Env – erst `set -a; . ./.secrets; set +a`'); process.exit(1) }
  console.log('\nWende an via psql …')
  const out = execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlOut], { encoding: 'utf8' })
  console.log(out.trim())
}
