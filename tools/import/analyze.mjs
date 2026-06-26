// ============================================================
// superbilly – Import-Analyzer (Stufe 1 + 2)
// Liest Quelldaten (vorerst die alte import-data.js als Excel-Proxy),
// erzeugt Validierungs-Reports für Mitarbeiter und Projekte mit
// Dedup-Vorschlägen, Sonderfall-Klassifizierung (Frei/Feiertag/System)
// und Müll-Erkennung. SCHREIBT NICHTS – nur Analyse zur Freigabe.
//
// Aufruf:  node tools/import/analyze.mjs [pfad/zur/quelle.js]
// Default: ../ressourcenplanung/import-data.js (relativ zum Repo-Root)
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const srcArg = process.argv[2] ?? resolve(repoRoot, '../ressourcenplanung/import-data.js')
const reportsDir = resolve(__dirname, 'reports')

// ---------- Helpers ----------
const norm = (s) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöüß]/g, '')

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

// Klassifizierung von "Projekten", die keine Projekte sind
function classify(name) {
  const n = name.toLowerCase()
  if (/^[\s0-9.,]+$/.test(name)) return { cat: 'MÜLL', target: null }
  if (/feiertag/.test(n)) return { cat: 'FEIERTAG', target: 'auto-Kalender (nicht importieren)' }
  if (/\bkrank/.test(n)) return { cat: 'SYSTEM', target: 'Krank' }
  if (/\burlaub/.test(n)) return { cat: 'SYSTEM', target: 'Urlaub' }
  if (/kurzarbeit/.test(n)) return { cat: 'SYSTEM', target: 'Kurzarbeit' }
  if (n === 'uni') return { cat: 'SYSTEM', target: 'Admin' }
  if (/(^|\b)(frei|freier? tag|frei aus|ausgleich)/.test(n)) return { cat: 'FREI', target: 'Frei' }
  return null // echtes Projekt (Kandidat)
}

// ---------- Laden ----------
const mod = await import(pathToFileURL(srcArg).href)
const data = mod.IMPORT_DATA ?? mod.default
if (!data?.employees || !data?.projects) {
  console.error('Quelle hat kein {employees, projects}:', srcArg)
  process.exit(1)
}
const { employees, projects, tasks = [] } = data

const bookingCount = {}
for (const t of tasks) bookingCount[t.projectId] = (bookingCount[t.projectId] || 0) + 1

// ============================================================
// STUFE 1 – Mitarbeiter
// ============================================================
const empIssues = []
const empNormSeen = {}
for (const e of employees) {
  const flags = []
  const cleanName = (e.name ?? '').replace(/\s+/g, ' ').trim()
  if (cleanName !== (e.name ?? '')) flags.push('Leerzeichen normalisieren')
  if (cleanName.split(' ').length < 2) flags.push('unvollständiger Name (kein Nachname?)')
  if (!e.email) flags.push('E-Mail fehlt (Pflicht für Personio-/SSO-Mapping)')
  const k = norm(cleanName)
  if (empNormSeen[k]) flags.push(`mögliches Duplikat von "${empNormSeen[k]}"`)
  else empNormSeen[k] = cleanName
  if (flags.length) empIssues.push({ name: cleanName, flags })
}

// ============================================================
// STUFE 2 – Projekte
// ============================================================
const special = { MÜLL: [], FEIERTAG: [], SYSTEM: [], FREI: [] }
const preSystem = [] // Altdaten bereits isVacation/System
const realProjects = []
for (const p of projects) {
  if (p.isVacation || p.is_system) {
    const c = classify(p.name)
    preSystem.push({
      name: p.name,
      bookings: bookingCount[p.id] || 0,
      suggest: c ? c.target ?? 'entfernen' : 'ENTSCHEIDUNG: eigene Kategorie nötig?',
    })
    continue
  }
  const c = classify(p.name)
  if (c) special[c.cat].push({ name: p.name, target: c.target, bookings: bookingCount[p.id] || 0 })
  else realProjects.push(p)
}

// Buchungen auf Projekt-IDs, die gar nicht im Projekt-Array stehen (z. B. __urlaub__)
const projIdSet = new Set(projects.map((p) => p.id))
const orphan = {}
for (const t of tasks) if (!projIdSet.has(t.projectId)) orphan[t.projectId] = (orphan[t.projectId] || 0) + 1

// Exakte Duplikate (nach Normalisierung)
const groups = {}
for (const p of realProjects) (groups[norm(p.name)] ||= []).push(p)
const exactDupes = Object.values(groups)
  .filter((g) => g.length > 1)
  .map((g) => g.map((p) => ({ name: p.name, bookings: bookingCount[p.id] || 0 })))

// Fuzzy-Kandidaten (über die kanonischen Keys, Tippfehler)
const keys = Object.keys(groups).filter((k) => k.length >= 5)
const fuzzy = []
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j]
    const d = levenshtein(a, b)
    const thresh = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.15))
    if (d <= thresh) {
      fuzzy.push({
        a: groups[a][0].name,
        b: groups[b][0].name,
        distanz: d,
      })
    }
  }
}

// ---------- Report schreiben ----------
mkdirSync(reportsDir, { recursive: true })
const L = []
L.push('# Import-Validierungsreport (Stufe 1 + 2)')
L.push(`\nQuelle: \`${srcArg}\``)
L.push(`\nMitarbeiter: ${employees.length} · Projekte (roh): ${projects.length} · Buchungen: ${tasks.length}`)

L.push('\n---\n\n## Stufe 1 – Mitarbeiter')
if (!empIssues.length) L.push('\nKeine Auffälligkeiten.')
else {
  L.push('\n| Name | Hinweise |')
  L.push('|---|---|')
  for (const e of empIssues) L.push(`| ${e.name} | ${e.flags.join('; ')} |`)
}

L.push('\n---\n\n## Stufe 2 – Bereits als Abwesenheit markiert (Altdaten isVacation)')
L.push('\n| Eintrag | Buchungen | Vorschlag |')
L.push('|---|---|---|')
for (const x of preSystem.sort((a, b) => b.bookings - a.bookings))
  L.push(`| ${JSON.stringify(x.name)} | ${x.bookings} | ${x.suggest} |`)

const orphanRows = Object.entries(orphan).sort((a, b) => b[1] - a[1])
if (orphanRows.length) {
  L.push('\n### Buchungen auf System-IDs (nicht im Projekt-Array)')
  L.push('\n| Projekt-ID | Buchungen | Vorschlag |')
  L.push('|---|---|---|')
  const map = { __urlaub__: 'Urlaub', __krank__: 'Krank', __admin__: 'Admin' }
  for (const [id, n] of orphanRows)
    L.push(`| \`${id}\` | ${n} | ${map[id] ?? 'ENTSCHEIDUNG'} |`)
}

L.push('\n---\n\n## Stufe 2 – Sonderfälle (kein Projekt)')
for (const [cat, items] of Object.entries(special)) {
  if (!items.length) continue
  const sum = items.reduce((s, x) => s + x.bookings, 0)
  L.push(`\n### ${cat} (${items.length} Einträge, ${sum} Buchungen) → ${items[0].target ?? 'entfernen'}`)
  L.push('\n| Eintrag | Buchungen |')
  L.push('|---|---|')
  for (const x of items.sort((a, b) => b.bookings - a.bookings))
    L.push(`| ${JSON.stringify(x.name)} | ${x.bookings} |`)
}

L.push('\n---\n\n## Stufe 2 – Exakte Duplikate (nach Normalisierung)')
if (!exactDupes.length) L.push('\nKeine.')
else
  for (const g of exactDupes)
    L.push(`\n- ${g.map((x) => `${JSON.stringify(x.name)} (${x.bookings} B.)`).join('  ↔  ')}`)

L.push('\n---\n\n## Stufe 2 – Fuzzy-Kandidaten (Tippfehler/Schreibweisen, prüfen)')
if (!fuzzy.length) L.push('\nKeine.')
else {
  L.push('\n| A | B | Distanz |')
  L.push('|---|---|---|')
  for (const f of fuzzy.sort((a, b) => a.distanz - b.distanz))
    L.push(`| ${JSON.stringify(f.a)} | ${JSON.stringify(f.b)} | ${f.distanz} |`)
}

const realCount = realProjects.length
const dupeShrink = exactDupes.reduce((s, g) => s + (g.length - 1), 0)
L.push('\n---\n\n## Zusammenfassung')
L.push(`\n- Roh-"Projekte": **${projects.length}**`)
L.push(`- davon Sonderfälle (Frei/Feiertag/System/Müll): **${Object.values(special).reduce((s, a) => s + a.length, 0)}**`)
L.push(`- echte Projektkandidaten: **${realCount}**`)
L.push(`- mind. durch exakte Duplikate zusammenführbar: **−${dupeShrink}**`)
L.push(`- zusätzlich zu prüfende Fuzzy-Paare: **${fuzzy.length}**`)
L.push(`- grobe Schätzung bereinigte Projekte: **~${realCount - dupeShrink - Math.ceil(fuzzy.length / 2)}**`)

const out = resolve(reportsDir, 'report.md')
writeFileSync(out, L.join('\n') + '\n')
console.log('Report geschrieben:', out)
console.log(L.slice(-9).join('\n'))
