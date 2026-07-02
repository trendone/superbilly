// ============================================================
// superbilly – Zoho-Matching-Test (Dry-Run, SCHREIBT NICHTS)
// Matcht die echten Projekt-Kandidaten aus der Excel (import-data.js-Proxy)
// gegen die per sync-zoho gespiegelten Zoho-Projekte (tools/import/zoho-projects.json).
//
// Zweistufig:
//  1) NAME: Token-Containment + Anker-/Firmentoken -> welche Firma / welcher Deal.
//  2) DATUM (Tie-Breaker bei Mehrdeutigkeit): hat eine Firma mehrere Deals mit
//     ähnlichem Namens-Score, entscheidet das Buchungsdatum. Zoho liefert nur das
//     Leistungsdatum (end_date) – Arbeit wird davor gebucht, also ordnen wir jede
//     Buchung dem Deal mit dem nächsten *kommenden* Leistungstermin zu.
//     Streut eine Firma über mehrere Termine -> SPLIT (echte Mehrfachzuordnung).
//
// Interne Kategorien (Sales/Admin/TS/...) werden NICHT gematcht (isSpecial/STOP).
//
// Aufruf:  node tools/import/match-zoho.mjs
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const excelSrc = resolve(repoRoot, '../ressourcenplanung/import-data.js')
const zohoSrc = resolve(__dirname, 'zoho-projects.json')
const reportsDir = resolve(__dirname, 'reports')

// ---- Sonderfall-/Intern-Klassifizierung (gleiche Logik wie analyze.mjs) ----
function isSpecial(name) {
  const n = name.toLowerCase()
  if (/^[\s0-9.,]+$/.test(name)) return true
  if (/feiertag/.test(n)) return true
  if (/\bkrank/.test(n)) return true
  if (/\burlaub/.test(n)) return true
  if (/kurzarbeit/.test(n)) return true
  if (n === 'uni') return true
  if (/(^|\b)(frei|freier? tag|frei aus|ausgleich)/.test(n)) return true
  return false
}

// Ziel-Disposition für Nicht-Projekt-Einträge: System-Kategorie (DB is_system) oder
// skip (Feiertag rechnet die App selbst; Müll = reine Zahlen/Datumsfragmente).
function classifyTarget(name) {
  const n = name.toLowerCase()
  if (/^[\s0-9.,]+$/.test(name)) return { type: 'skip', reason: 'müll' }
  if (/feiertag/.test(n)) return { type: 'skip', reason: 'feiertag' }
  if (/\bkrank/.test(n)) return { type: 'system', target: 'Krank' }
  if (/\burlaub/.test(n)) return { type: 'system', target: 'Urlaub' }
  if (/kurzarbeit/.test(n)) return { type: 'system', target: 'Kurzarbeit' }
  if (n === 'uni') return { type: 'system', target: 'Admin' }
  if (/(^|\b)(frei|freier? tag|frei aus|ausgleich)/.test(n)) return { type: 'system', target: 'Frei' }
  return null
}

const STOP = new Set([
  'gmbh', 'ag', 'co', 'kg', 'group', 'angebot', 'workshop', 'keynote', 'visionary',
  'trend', 'trends', 'future', 'zukunft', 'zukunftsmut', 'update', 'sparring',
  'der', 'die', 'das', 'und', 'im', 'in', 'am', 'von', 'für', 'fur', 'the',
  'nb', 'online', 'nils', 'müller', 'muller', 'nm', 'inkl', 'session', 'studie',
  'impuls', 'impulsvortrag', 'vortrag', 'event', 'modul', 'research', 'innovation',
])
const MONTHS = new Set(['jan','feb','mrz','mar','apr','mai','jun','jul','aug','sep','okt','oct','nov','dez'])

function tokens(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !MONTHS.has(t))
    .filter((t) => !STOP.has(t))
}

// ---- Datums-Helfer ----
const DAY = 86400000
const toD = (s) => new Date(s + 'T00:00:00Z')
function businessDays(start, end) {
  const out = []
  let d = toD(start)
  const e = toD(end)
  while (d <= e) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(new Date(d))
    d = new Date(d.getTime() + DAY)
  }
  return out
}
// Abstand Buchungstag -> Leistungstermin. Vor dem Termin gebucht = ideal;
// nach dem Termin wird mit Faktor 3 bestraft (aber nicht ausgeschlossen).
function gap(bookingDay, leistung) {
  const diff = (toD(leistung).getTime() - bookingDay.getTime()) / DAY
  return diff >= 0 ? diff : -diff * 3
}

// ---- Excel laden + Kandidaten bilden ----
const mod = await import(pathToFileURL(excelSrc).href)
const data = mod.IMPORT_DATA ?? mod.default

// Split-Day-Kombi: ein Excel-Eintrag wie "Rauch / Amprion" = an einem (halben) Tag
// auf mehrere Kunden gebucht. Am "/" auftrennen, jede Seite separat matchen und die
// Buchungszeit anteilig (1/Teile) auf die Kunden-Kandidaten verteilen.
const splitParts = (name) => name.split('/').map((s) => s.trim()).filter(Boolean)

// projectId -> [{key, frac}]; interne/Sonderfälle ausgeschlossen. Kombis -> mehrere Keys.
const partsByPid = {}
const comboByPid = {}
const dispoByPid = {} // pid -> {type:'system',target} | {type:'skip',reason} | {type:'project',parts}
const candMap = new Map()
function ensureCand(toks, display) {
  const key = toks.join(' ')
  if (!key) return null
  const prev = candMap.get(key)
  if (prev) { prev.aliases.add(display); return key }
  candMap.set(key, { key, display, toks, aliases: new Set([display]), days: [], bookings: 0 })
  return key
}
for (const p of data.projects) {
  const target = classifyTarget(p.name)
  if (target) { dispoByPid[p.id] = target; continue }
  const display = p.name.replace(/\s+/g, ' ').trim()
  const partPairs = splitParts(p.name)
    .map((s) => ({ raw: s, toks: tokens(s) }))
    .filter((x) => x.toks.length)
  if (!partPairs.length) { dispoByPid[p.id] = { type: 'skip', reason: 'kein-token' }; continue }
  const isCombo = partPairs.length >= 2
  const keys = []
  for (const { raw, toks } of partPairs) {
    const key = ensureCand(toks, isCombo ? raw : display)
    if (key && !keys.includes(key)) keys.push(key)
  }
  if (!keys.length) { dispoByPid[p.id] = { type: 'skip', reason: 'kein-token' }; continue }
  const frac = 1 / keys.length
  partsByPid[p.id] = keys.map((key) => ({ key, frac }))
  dispoByPid[p.id] = { type: 'project', parts: partsByPid[p.id] }
  if (isCombo) comboByPid[p.id] = { name: display, parts: keys, bookings: 0 }
}
// Orphan-IDs (von Tasks referenziert, aber nicht im projects-Array)
dispoByPid['__urlaub__'] = { type: 'system', target: 'Urlaub' }
dispoByPid['__krank__'] = { type: 'system', target: 'Krank' }

// Buchungen auf Geschäftstage expandieren (echte Tagesdaten, nicht der gemergte
// Task-Range); Kombi-Buchungen anteilig auf die beteiligten Kunden verteilen.
for (const t of data.tasks) {
  const parts = partsByPid[t.projectId]
  if (!parts) continue
  const w0 = typeof t.budget === 'number' && t.budget > 0 ? t.budget : 1
  const bd = businessDays(t.startDate, t.endDate)
  if (comboByPid[t.projectId]) comboByPid[t.projectId].bookings += 1
  for (const { key, frac } of parts) {
    const c = candMap.get(key)
    c.bookings += 1
    for (const d of bd) c.days.push({ d, w: w0 * frac })
  }
}
const candidates = [...candMap.values()].sort((a, b) => b.bookings - a.bookings)
const combos = Object.values(comboByPid).sort((a, b) => b.bookings - a.bookings)

// ---- Zoho laden ----
const zoho = JSON.parse(readFileSync(zohoSrc, 'utf8')).map((z) => {
  const tl = tokens(z.name)
  return { ...z, toks: new Set(tl), tokList: tl }
})

// ---- Token-Level-Fuzzy (Tippfehler/Schreibvarianten) ----
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}
// Erlaubte Editierdistanz je Tokenlänge: kurze Tokens exakt (sonst Fehltreffer),
// 5–7 Zeichen 1 Edit, ab 8 Zeichen 2 Edits.
const fuzzyMax = (len) => (len <= 4 ? 0 : len <= 7 ? 1 : 2)
// 1 = exakter Treffer, 0.9 = Fuzzy-Treffer (leicht abgewertet), 0 = kein Treffer.
function tokenHit(t, set, list) {
  if (set.has(t)) return 1
  const max = fuzzyMax(t.length)
  if (!max) return 0
  for (const u of list) {
    if (Math.abs(u.length - t.length) > max) continue
    if (levenshtein(t, u) <= max) return 0.9
  }
  return 0
}

// ---- Namens-Score ----
function nameScore(cand, z) {
  if (!cand.toks.length) return { s: 0, anchorHit: false }
  let hit = 0
  for (const t of cand.toks) hit += tokenHit(t, z.toks, z.tokList)
  const containment = hit / cand.toks.length
  const anchor = [...cand.toks].sort((a, b) => b.length - a.length)[0]
  const anchorHit = tokenHit(anchor, z.toks, z.tokList) > 0
  return { s: containment * (anchorHit ? 1 : 0.3), anchorHit }
}

const SURE = 0.75      // Namens-Score ab hier "sicher"
const MAYBE = 0.45     // darunter kein ernsthafter Treffer
const PLAUS_MARGIN = 0.25  // Deals innerhalb dieses Namens-Score-Abstands = gleichberechtigte Kandidaten
const DOMINANT = 0.7   // Anteil der Buchungstage für einen Deal -> als eindeutig (datum) werten

const pct = (s) => (s == null ? '—' : Math.round(s * 100) + '%')
const ym = (d) => d.toISOString().slice(0, 7)

const results = candidates.map((c) => {
  const scored = zoho
    .map((z) => ({ z, ...nameScore(c, z) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const best = scored[0]
  if (!best || best.s < MAYBE) return { c, verdict: 'KEIN', best, scored }

  // Gleichberechtigte Kandidaten (gleiche Firma, ähnlicher Namens-Score, Anker getroffen)
  const plausible = scored.filter((x) => x.anchorHit && x.s >= best.s - PLAUS_MARGIN && x.s >= 0.5)

  // Eindeutig schon über den Namen?
  if (plausible.length <= 1) {
    const second = scored[1]
    const verdict =
      best.s >= SURE && (!second || best.s - second.s >= 0.2) ? 'SICHER' : 'UNSICHER'
    return { c, verdict, best, second, scored, by: 'name' }
  }

  // ---- Datums-Tie-Breaker: jeden Buchungstag dem nächsten Leistungstermin zuordnen ----
  const datedDeals = plausible.filter((x) => x.z.date)
  if (!datedDeals.length || !c.days.length) {
    // Datum nicht nutzbar -> bleibt unsicher
    return { c, verdict: 'UNSICHER', best, second: scored[1], scored, by: 'name', plausible }
  }
  const tally = new Map() // dealId -> gewichtete Buchungstage
  for (const { d, w } of c.days) {
    let bestDeal = null, bestGap = Infinity
    for (const x of datedDeals) {
      const g = gap(d, x.z.date)
      if (g < bestGap) { bestGap = g; bestDeal = x }
    }
    if (bestDeal) tally.set(bestDeal.z.id, (tally.get(bestDeal.z.id) || 0) + w)
  }
  const dist = [...tally.entries()]
    .map(([id, w]) => ({ z: datedDeals.find((x) => x.z.id === id).z, w }))
    .sort((a, b) => b.w - a.w)
  const total = dist.reduce((s, x) => s + x.w, 0)
  const share = total ? dist[0].w / total : 0
  if (share >= DOMINANT) {
    return { c, verdict: 'SICHER', best: { z: dist[0].z, s: best.s }, scored, by: 'datum', dist, share }
  }
  return { c, verdict: 'SPLIT', scored, by: 'datum', dist, share, plausible }
})

// ---- Manuelle Overrides anwenden (überleben Re-Runs) ----
// overrides.json: { "<excel-key>": "<Angebotsnr | Zoho-Name | UUID | KEIN>" }
// Der key ist der normalisierte Excel-Kandidaten-Key (siehe match-map.json .decisions[].key).
// Ziel wird gegen zoho-projects.json aufgelöst (offer -> id -> name). Spezialwert "KEIN"
// zwingt den Kandidaten in ein eigenes Excel-Projekt. Overrides greifen unabhängig vom
// heuristischen Verdict (korrigieren also auch falsche SICHER/SPLIT).
const ovPath = resolve(__dirname, 'overrides.json')
let overrides = {}
try { overrides = JSON.parse(readFileSync(ovPath, 'utf8')) } catch { /* keine Datei = keine Overrides */ }
const zById = new Map(zoho.map((z) => [z.id, z]))
const zByOffer = new Map(zoho.filter((z) => z.offer).map((z) => [String(z.offer).trim().toLowerCase(), z]))
const zByName = new Map(zoho.map((z) => [z.name.trim().toLowerCase(), z]))
const resByKeyEarly = new Map(results.map((r) => [r.c.key, r]))
const ovApplied = [], ovUnmatchedKey = [], ovUnresolved = []
for (const rawKey of Object.keys(overrides)) {
  if (rawKey.startsWith('_')) continue // _comment / _beispiel etc.
  const r = resByKeyEarly.get(rawKey)
  if (!r) { ovUnmatchedKey.push(rawKey); continue }
  const t = String(overrides[rawKey]).trim()
  if (t.toUpperCase() === 'KEIN') {
    r.verdict = 'KEIN'; r.by = 'override'; r.best = undefined; r.dist = undefined; r.plausible = undefined
    ovApplied.push({ key: rawKey, to: 'KEIN (eigenes Excel-Projekt)' })
    continue
  }
  const z = zById.get(t) || zByOffer.get(t.toLowerCase()) || zByName.get(t.toLowerCase())
  if (!z) { ovUnresolved.push({ key: rawKey, target: overrides[rawKey] }); continue }
  r.verdict = 'SICHER'; r.by = 'override'; r.best = { z, s: 1 }
  r.dist = undefined; r.plausible = undefined
  ovApplied.push({ key: rawKey, to: `${z.name}${z.offer ? ` (${z.offer})` : ''}` })
}

const buckets = { SICHER: [], SPLIT: [], UNSICHER: [], KEIN: [] }
for (const r of results) buckets[r.verdict].push(r)
const sureName = buckets.SICHER.filter((r) => r.by === 'name')
const sureDate = buckets.SICHER.filter((r) => r.by === 'datum')
const resByKey = new Map(results.map((r) => [r.c.key, r]))

// ---- Report ----
mkdirSync(reportsDir, { recursive: true })
const L = []
const distStr = (dist) =>
  dist.map((x) => `${Math.round(x.w)}d → ${x.z.name.slice(0, 38)} (${ym(toD(x.z.date))})`).join('; ')

L.push('# Zoho-Matching-Test (Dry-Run) – mit Datums-Tie-Breaker')
L.push(`\nExcel-Kandidaten: **${candidates.length}** · Zoho-Projekte: **${zoho.length}**`)
const sureOverride = buckets.SICHER.filter((r) => r.by === 'override')
L.push(`\n- ✅ SICHER gesamt: **${buckets.SICHER.length}**  (über Name: ${sureName.length} · über Datum aufgelöst: ${sureDate.length} · manuell: ${sureOverride.length})`)
L.push(`- 🔀 SPLIT (Firma streut über mehrere Deals/Termine): **${buckets.SPLIT.length}**`)
L.push(`- ⚠️ UNSICHER (Name mittel, Datum löst nicht): **${buckets.UNSICHER.length}**`)
L.push(`- ❌ KEIN TREFFER (interne Kategorie / kein Zoho-Deal): **${buckets.KEIN.length}**`)

L.push('\n---\n\n## 🔧 Manuelle Overrides (aus overrides.json – überleben Re-Runs)')
if (!ovApplied.length && !ovUnmatchedKey.length && !ovUnresolved.length) {
  L.push('\nKeine. (Datei `overrides.json` fehlt oder ist leer.)')
} else {
  if (ovApplied.length) {
    L.push('\n| Excel-Key | → Ziel |')
    L.push('|---|---|')
    for (const o of ovApplied) L.push(`| \`${o.key}\` | ${o.to} |`)
  }
  if (ovUnmatchedKey.length)
    L.push(`\n⚠️ **${ovUnmatchedKey.length} Override-Key(s) ohne passenden Excel-Kandidaten** (Tippfehler? Kandidat existiert nicht mehr?): ${ovUnmatchedKey.map((k) => `\`${k}\``).join(', ')}`)
  if (ovUnresolved.length)
    L.push(`\n⚠️ **${ovUnresolved.length} Override-Ziel(e) nicht in Zoho auflösbar** (Angebotsnr/Name/UUID prüfen, ggf. \`export-zoho.sh\` neu ziehen): ${ovUnresolved.map((o) => `\`${o.key}\` → \`${o.target}\``).join(', ')}`)
}

L.push('\n---\n\n## ✅ SICHER – über Datum aufgelöst (vorher mehrdeutig)')
if (!sureDate.length) L.push('\nKeine.')
else {
  L.push('\n| Excel | B. | → Zoho-Deal | Anteil Tage | Datums-Verteilung |')
  L.push('|---|--:|---|--:|---|')
  for (const r of sureDate.sort((a, b) => b.c.bookings - a.c.bookings))
    L.push(`| ${r.c.display} | ${r.c.bookings} | ${r.best.z.name} | ${pct(r.share)} | ${distStr(r.dist)} |`)
}

L.push('\n---\n\n## 🔀 SPLIT – mappt über die Zeit auf mehrere Deals')
if (!buckets.SPLIT.length) L.push('\nKeine.')
else {
  L.push('\n_Diese Excel-Einträge sind keine Fehlmatches – die Firma hatte parallel mehrere Aufträge. Beim echten Import ggf. buchungsweise (nach Datum) auf die Deals aufteilen._')
  L.push('\n| Excel | B. | Aufteilung (Tage → Deal) |')
  L.push('|---|--:|---|')
  for (const r of buckets.SPLIT.sort((a, b) => b.c.bookings - a.c.bookings))
    L.push(`| ${r.c.display} | ${r.c.bookings} | ${distStr(r.dist)} |`)
}

L.push('\n---\n\n## ✅ SICHER – über Name (eindeutig)')
L.push('\n| Excel | B. | → Zoho | Score |')
L.push('|---|--:|---|--:|')
for (const r of sureName.sort((a, b) => b.c.bookings - a.c.bookings))
  L.push(`| ${r.c.display} | ${r.c.bookings} | ${r.best.z.name} | ${pct(r.best.s)} |`)

L.push('\n---\n\n## ⚠️ UNSICHER (bitte prüfen)')
L.push('\n| Excel | B. | Top-Kandidat | Score | 2. Kandidat | Score |')
L.push('|---|--:|---|--:|---|--:|')
for (const r of buckets.UNSICHER.sort((a, b) => b.c.bookings - a.c.bookings))
  L.push(`| ${r.c.display} | ${r.c.bookings} | ${r.best.z.name} | ${pct(r.best.s)} | ${r.second?.z.name ?? '—'} | ${pct(r.second?.s)} |`)

L.push(`\n---\n\n## 🔗 Split-Day-Kombis (${combos.length}) – am "/" aufgetrennt, Zeit anteilig verteilt`)
L.push('\n_Mehrere Kunden an einem Tag. Jede Seite separat gematcht; die Buchungszeit fließt anteilig in die Kunden-Kandidaten (taucht daher nicht mehr als eigener „unsicherer" Eintrag auf)._')
const partLabel = (k) => {
  const r = resByKey.get(k), cand = candMap.get(k)
  const nm = cand?.display ?? k
  if (!r) return `${nm} → ?`
  if (r.verdict === 'SICHER') return `${nm} → ✅ ${r.best.z.name.slice(0, 30)}`
  if (r.verdict === 'SPLIT') return `${nm} → 🔀 split`
  if (r.verdict === 'UNSICHER') return `${nm} → ⚠️`
  return `${nm} → ❌ kein`
}
if (!combos.length) L.push('\nKeine.')
else {
  L.push('\n| Excel-Kombi | B. | Teile → Auflösung |')
  L.push('|---|--:|---|')
  for (const cb of combos) L.push(`| ${cb.name} | ${cb.bookings} | ${cb.parts.map(partLabel).join(' · ')} |`)
}

L.push('\n---\n\n## ❌ KEIN TREFFER (interne Kategorie / kein Zoho-Deal)')
L.push(`\n${buckets.KEIN.length} Einträge – erwartbar (Sales/Admin/TS/Intern/Akquise/Altprojekte). Nicht zu matchen.`)

const out = resolve(reportsDir, 'match-zoho.md')
writeFileSync(out, L.join('\n') + '\n')

// ---- Maschinenlesbare Map (Input für den späteren Import / Delta) ----
const zRef = (z) => ({ zohoId: z.id, zohoName: z.name, offer: z.offer })
const map = {
  generatedFrom: excelSrc,
  zohoCount: zoho.length,
  candidateCount: candidates.length,
  decisions: results.map((r) => ({
    key: r.c.key,
    display: r.c.display,
    aliases: [...r.c.aliases],
    bookings: r.c.bookings,
    verdict: r.verdict,
    by: r.by ?? null,
    match: r.verdict === 'SICHER' ? zRef(r.best.z) : null,
    split: r.verdict === 'SPLIT' ? r.dist.map((x) => ({ ...zRef(x.z), date: x.z.date, days: Math.round(x.w) })) : null,
    candidates:
      r.verdict === 'UNSICHER'
        ? r.scored.slice(0, 3).map((x) => ({ ...zRef(x.z), score: Math.round(x.s * 100) / 100 }))
        : null,
  })),
  combos: combos.map((cb) => ({ name: cb.name, bookings: cb.bookings, parts: cb.parts })),
  // Vollständige Import-Anweisung je Excel-Projekt-ID: der Writer muss die
  // Token-/Kombi-Logik nicht duplizieren.
  projectDispositions: dispoByPid,
}
const mapOut = resolve(reportsDir, 'match-map.json')
writeFileSync(mapOut, JSON.stringify(map, null, 2) + '\n')

console.log('Report:', out)
console.log('Map:   ', mapOut)
console.log(`SICHER ${buckets.SICHER.length} (Name ${sureName.length} / Datum ${sureDate.length} / manuell ${sureOverride.length}) · SPLIT ${buckets.SPLIT.length} · UNSICHER ${buckets.UNSICHER.length} · KEIN ${buckets.KEIN.length}`)
if (ovApplied.length) console.log(`Overrides angewandt: ${ovApplied.length}`)
if (ovUnmatchedKey.length) console.warn(`⚠️  Override-Keys ohne Excel-Kandidat: ${ovUnmatchedKey.join(', ')}`)
if (ovUnresolved.length) console.warn(`⚠️  Override-Ziele nicht in Zoho auflösbar: ${ovUnresolved.map((o) => `${o.key}→${o.target}`).join(', ')}`)
