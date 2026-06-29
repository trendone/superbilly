import { useEffect, useMemo, useState } from 'react'
import {
  employeeMonthStats,
  fetchAnalytics,
  monthDetail,
  monthWindow,
  projectStats,
  summarize,
  teamKpis,
  yearWindow,
  KEYNOTE_KTR,
  STANDARD_DAY_RATE,
  type AnalyticsData,
  type Employee,
  type Health,
  type MonthWindow,
  type ProjectStat,
} from '../lib/analytics'
import { supabase } from '../lib/supabase'

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
/** Hintergrund-/Vordergrundfarbe einer Heatmap-Zelle nach Auslastung. */
function heatColor(pct: number, hasCap: boolean): { bg: string; fg: string } {
  if (!hasCap) return { bg: '#f1f5f9', fg: '#94a3b8' }
  if (pct === 0) return { bg: '#eff6ff', fg: '#94a3b8' }
  if (pct < 70) return { bg: '#dbeafe', fg: '#1e40af' } // unterausgelastet (blau)
  if (pct <= 100) return { bg: '#dcfce7', fg: '#166534' } // gut (grün)
  if (pct <= 115) return { bg: '#fef3c7', fg: '#92400e' } // knapp drüber (gelb)
  return { bg: '#fee2e2', fg: '#991b1b' } // überlastet (rot)
}

const healthTone: Record<Health, string> = { over: 'red', tight: 'amber', ok: 'green', none: 'dim' }

/** Tooltip für die Tagessatz-Zelle: zeigt die definierten Mite-Sätze (× Stunden). */
function rateTooltip(breakdown: { rate: number; hours: number }[], blended: number | null): string {
  if (!breakdown.length) return 'kein Mite-Tagessatz'
  if (breakdown.length === 1) return `Tagessatz ${eur.format(breakdown[0].rate)} (aus Mite)`
  const parts = breakdown.map((b) => `${eur.format(b.rate)} × ${b.hours} h`).join(' · ')
  return `Tagessätze: ${parts}${blended != null ? ` · Ø ${eur.format(blended)}` : ''}`
}

/** Quelle des Tagessatzes als Tooltip + Kurzmarker. */
function rateTitle(p: ProjectStat): string {
  if (p.rateSource === 'manuell') return 'Tagessatz manuell gesetzt'
  if (p.rateSource === 'standard') return `Standard ${eur.format(STANDARD_DAY_RATE)} (kein Mite-Ist, keine manuelle Eingabe)`
  return rateTooltip(p.rateBreakdown, p.dayRateEur)
}
const rateMark = (s: ProjectStat['rateSource']) => (s === 'manuell' ? ' ✎' : s === 'standard' ? ' ≈' : '')
/** Tages-Delta als String mit Vorzeichen. */
const dT = (v: number | null) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10} T`)

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(';'),
    )
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type SubTab = 'projekte' | 'mitarbeiter'
type Period = '6m' | 'year'
type Sort = 'health' | 'name' | 'diff' | 'util'
type StatusFilter = 'alle' | 'aktiv' | 'akquise' | 'pausiert' | 'abgeschlossen'

interface Selected {
  emp: Employee
  win: MonthWindow
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sub, setSub] = useState<SubTab>('projekte')

  // Mitarbeiter-Controls
  const [period, setPeriod] = useState<Period>('6m')
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [selected, setSelected] = useState<Selected | null>(null)

  // Projekt-Controls
  const [sort, setSort] = useState<Sort>('health')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle')
  const [catFilter, setCatFilter] = useState<string>('no-keynote') // Default: Keynotes ausgeblendet

  function load() {
    return fetchAnalytics()
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    fetchAnalytics()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message ?? String(e)))
      .finally(() => !cancelled && setLoading(false))

    // Live-Update: bei Änderungen an relevanten Tabellen neu laden.
    const ch = supabase
      ?.channel('analytics-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_actuals' }, () => load())
      .subscribe()

    return () => {
      cancelled = true
      if (ch) supabase?.removeChannel(ch)
    }
  }, [])

  const months = useMemo<MonthWindow[]>(
    () => (period === 'year' ? yearWindow(year) : monthWindow(new Date(), -2, 3)),
    [period, year],
  )

  const allStats = useMemo(() => (data ? projectStats(data) : []), [data])

  // Distinkte Leistungskategorien (für das Filter-Dropdown).
  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const p of allStats) if (p.productLabel) s.add(p.productLabel)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [allStats])

  const projects = useMemo(() => {
    let list = allStats
    if (statusFilter !== 'alle') list = list.filter((p) => p.project.status === statusFilter)
    if (catFilter === 'no-keynote')
      list = list.filter((p) => !p.productKtr || !(KEYNOTE_KTR as readonly string[]).includes(p.productKtr))
    else if (catFilter !== 'alle') list = list.filter((p) => p.productLabel === catFilter)
    const order: Record<Health, number> = { over: 0, tight: 1, ok: 2, none: 3 }
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.project.name.localeCompare(b.project.name)
      if (sort === 'diff') return (a.diffDays ?? Infinity) - (b.diffDays ?? Infinity)
      if (sort === 'util') return (b.budgetPct ?? -1) - (a.budgetPct ?? -1)
      return order[a.health] - order[b.health] || a.project.name.localeCompare(b.project.name)
    })
  }, [allStats, sort, statusFilter, catFilter])

  const kpis = useMemo(() => (data ? teamKpis(data) : null), [data])

  function exportProjects() {
    const rows: (string | number)[][] = [
      ['Projekt', 'Kunde', 'Leistungskategorie', 'KTR', 'Status', 'Budget (€)', 'Tagessatz (€)', 'Tagessatz-Quelle', 'Budget (T)', 'Plan (T)', 'Ist (T)', 'Ist (€)', 'Δ Ist/Budget (T)', 'Δ Plan/Budget (T)', 'Δ Ist/Plan (T)', 'Verbrauch %', 'Prognose'],
    ]
    for (const p of projects)
      rows.push([
        p.project.name,
        p.project.client ?? '',
        p.productLabel ?? '',
        p.productKtr ?? '',
        p.project.status,
        p.budgetEur ?? '',
        p.dayRateEur ?? '',
        p.rateSource ?? '',
        p.budgetDaysEff ?? '',
        p.bookedDays || '',
        p.hasMite ? p.istMiteDays : '',
        p.istMiteEur ?? '',
        p.deltaIstBudgetDays ?? '',
        p.deltaPlanBudgetDays ?? '',
        p.deltaIstPlanDays ?? '',
        p.budgetConsumedPct ?? '',
        p.forecast,
      ])
    downloadCSV('auswertung-projekte.csv', rows)
  }

  function exportEmployees() {
    if (!data) return
    const rows: (string | number)[][] = [['Mitarbeiter', ...months.map((m) => m.label), 'Σ %']]
    for (const emp of data.employees) {
      const stats = employeeMonthStats(emp, data, months)
      const sum = summarize(stats)
      rows.push([emp.name, ...stats.map((s) => `${s.pct}%`), `${sum.pct}%`])
    }
    downloadCSV('auswertung-mitarbeiter.csv', rows)
  }

  return (
    <div className="analytics">
      <div className="ana-head">
        <div className="sub-tabs">
          <button className={`tab${sub === 'projekte' ? ' active' : ''}`} onClick={() => setSub('projekte')}>
            📊 Projekte
          </button>
          <button className={`tab${sub === 'mitarbeiter' ? ' active' : ''}`} onClick={() => setSub('mitarbeiter')}>
            👥 Mitarbeiter
          </button>
        </div>
        <button
          className="btn-ghost"
          onClick={sub === 'projekte' ? exportProjects : exportEmployees}
          disabled={!data}
        >
          ⬇ CSV
        </button>
      </div>

      {error && <div className="status err">✕ {error}</div>}
      {loading && <div className="status pending">… lädt</div>}

      {data && sub === 'projekte' && (
        <ProjectsView
          projects={projects}
          sort={sort}
          setSort={setSort}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          catFilter={catFilter}
          setCatFilter={setCatFilter}
          categories={categories}
        />
      )}

      {data && sub === 'mitarbeiter' && (
        <EmployeesView
          data={data}
          months={months}
          period={period}
          setPeriod={setPeriod}
          year={year}
          setYear={setYear}
          kpis={kpis}
          selected={selected}
          setSelected={setSelected}
        />
      )}
    </div>
  )
}

// ── Projekt-Ansicht ──────────────────────────────────────────────────────

function ProjectsView({
  projects,
  sort,
  setSort,
  statusFilter,
  setStatusFilter,
  catFilter,
  setCatFilter,
  categories,
}: {
  projects: ProjectStat[]
  sort: Sort
  setSort: (s: Sort) => void
  statusFilter: StatusFilter
  setStatusFilter: (s: StatusFilter) => void
  catFilter: string
  setCatFilter: (s: string) => void
  categories: string[]
}) {
  const tot = projects.reduce(
    (a, p) => ({
      budgetEur: a.budgetEur + (p.budgetEur ?? 0),
      budgetDays: a.budgetDays + (p.budgetDaysEff ?? 0),
      plan: a.plan + p.bookedDays,
      ist: a.ist + p.istMiteDays,
      dIstBud: a.dIstBud + (p.deltaIstBudgetDays ?? 0),
      dPlanBud: a.dPlanBud + (p.deltaPlanBudgetDays ?? 0),
      dIstPlan: a.dIstPlan + (p.deltaIstPlanDays ?? 0),
      istEur: a.istEur + (p.istMiteEur ?? 0),
      budEurMite: a.budEurMite + (p.budgetConsumedPct != null ? (p.budgetEur ?? 0) : 0),
    }),
    { budgetEur: 0, budgetDays: 0, plan: 0, ist: 0, dIstBud: 0, dPlanBud: 0, dIstPlan: 0, istEur: 0, budEurMite: 0 },
  )
  const totConsumedPct = tot.budEurMite > 0 ? Math.round((tot.istEur / tot.budEurMite) * 100) : null

  return (
    <section className="ana-section">
      <div className="ana-toolbar">
        <label>
          Status{' '}
          <select className="field-inline" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="alle">Alle</option>
            <option value="aktiv">Aktiv</option>
            <option value="akquise">Akquise</option>
            <option value="pausiert">Pausiert</option>
            <option value="abgeschlossen">Abgeschlossen</option>
          </select>
        </label>
        <label>
          Kategorie{' '}
          <select className="field-inline" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="no-keynote">Ohne Keynotes</option>
            <option value="alle">Alle</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Sortierung{' '}
          <select className="field-inline" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="health">Überbucht zuerst</option>
            <option value="util">Auslastung</option>
            <option value="diff">Differenz</option>
            <option value="name">Name</option>
          </select>
        </label>
        <span className="dim">{projects.length} Projekte</span>
      </div>

      {projects.length === 0 ? (
        <p className="muted">Keine Projekte für diesen Filter.</p>
      ) : (
        <div className="table-scroll">
        <table className="ana-table">
          <thead>
            <tr>
              <th>Projekt</th>
              <th className="num">Budget €</th>
              <th className="num">Tagessatz</th>
              <th className="num">Budget (T)</th>
              <th className="num">Plan (T)</th>
              <th className="num">Ist (T)</th>
              <th className="num" title="Budget (T) − Ist (T)">Δ Ist/Budget</th>
              <th className="num" title="Budget (T) − Plan (T)">Δ Plan/Budget</th>
              <th className="num" title="Ist (T) − Plan (T)">Δ Ist/Plan</th>
              <th className="num">Verbrauch %</th>
              <th>Prognose</th>
              <th>Mitarbeiter</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.project.id}>
                <td>
                  <span className="dot" style={{ background: p.project.color ?? '#94a3b8' }} />
                  {p.project.name}
                  {(p.project.client || p.productLabel) && (
                    <div className="dim">{[p.project.client, p.productLabel].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td className="num dim">{p.budgetEur != null ? eur.format(p.budgetEur) : '–'}</td>
                <td className="num dim" title={rateTitle(p)}>
                  {eur.format(p.dayRateEur ?? STANDARD_DAY_RATE)}{rateMark(p.rateSource)}
                </td>
                <td className="num dim">{p.budgetDaysEff != null ? `${p.budgetDaysEff} T` : '–'}</td>
                <td className="num dim">{p.bookedDays > 0 ? `${p.bookedDays} T` : '–'}</td>
                <td className="num dim" title={p.hasMite ? `${p.istMiteHours} h${p.istMiteEur != null ? ` · ${eur.format(p.istMiteEur)}` : ''}` : 'keine Mite-Ist-Zeiten'}>
                  {p.hasMite ? `${p.istMiteDays} T` : '–'}
                </td>
                <td className={`num ${p.deltaIstBudgetDays == null ? 'dim' : p.deltaIstBudgetDays < 0 ? 'red' : 'green'}`}>
                  {dT(p.deltaIstBudgetDays)}
                </td>
                <td className={`num ${p.deltaPlanBudgetDays == null ? 'dim' : p.deltaPlanBudgetDays < 0 ? 'red' : 'green'}`}>
                  {dT(p.deltaPlanBudgetDays)}
                </td>
                <td className={`num ${p.deltaIstPlanDays == null ? 'dim' : p.deltaIstPlanDays < 0 ? 'amber' : ''}`}>
                  {dT(p.deltaIstPlanDays)}
                </td>
                <td className={`num ${p.budgetConsumedPct == null ? 'dim' : p.budgetConsumedPct > 100 ? 'red' : p.budgetConsumedPct >= 90 ? 'amber' : 'green'}`}>
                  {p.budgetConsumedPct == null ? '–' : `${p.budgetConsumedPct}%`}
                </td>
                <td>
                  <span className={`badge ${healthTone[p.health]}`}>{p.forecast}</span>
                </td>
                <td className="dim">{p.employeeNames.join(', ') || '–'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Summe</td>
              <td className="num dim">{eur.format(tot.budgetEur)}</td>
              <td className="num dim">–</td>
              <td className="num dim">{tot.budgetDays > 0 ? `${Math.round(tot.budgetDays * 10) / 10} T` : '–'}</td>
              <td className="num dim">{tot.plan > 0 ? `${Math.round(tot.plan * 10) / 10} T` : '–'}</td>
              <td className="num dim">{tot.ist > 0 ? `${Math.round(tot.ist * 10) / 10} T` : '–'}</td>
              <td className={`num ${tot.dIstBud < 0 ? 'red' : 'green'}`}>{dT(tot.dIstBud)}</td>
              <td className={`num ${tot.dPlanBud < 0 ? 'red' : 'green'}`}>{dT(tot.dPlanBud)}</td>
              <td className={`num ${tot.dIstPlan < 0 ? 'amber' : ''}`}>{dT(tot.dIstPlan)}</td>
              <td className={`num ${totConsumedPct == null ? 'dim' : totConsumedPct > 100 ? 'red' : totConsumedPct >= 90 ? 'amber' : 'green'}`}>
                {totConsumedPct == null ? '–' : `${totConsumedPct}%`}
              </td>
              <td colSpan={2} className="dim"></td>
            </tr>
          </tfoot>
        </table>
        </div>
      )}
      <p className="hint">
        Drei Größen je Projekt: <b>Budget (T)</b> = Budget-€ / Tagessatz · <b>Plan (T)</b> = verplante Tage ·
        <b> Ist (T)</b> = getrackte Zeit aus Mite. Tagessatz: <i>aus Mite-Ist</i>, sonst Standard {eur.format(STANDARD_DAY_RATE)} (≈),
        manuell pro Projekt überschreibbar (✎). Deltas: <b>Ist/Budget</b> = Budget-Rest (<span className="red">rot</span> = über Budget),
        <b> Plan/Budget</b> = noch verplanbar, <b>Ist/Plan</b> = Erfassung vs. Plan (<span className="amber">gelb</span> = weniger getrackt als geplant).
      </p>
    </section>
  )
}

// ── Mitarbeiter-Ansicht (Heatmap + KPIs + Drilldown) ───────────────────────

function EmployeesView({
  data,
  months,
  period,
  setPeriod,
  year,
  setYear,
  kpis,
  selected,
  setSelected,
}: {
  data: AnalyticsData
  months: MonthWindow[]
  period: Period
  setPeriod: (p: Period) => void
  year: number
  setYear: (y: number) => void
  kpis: ReturnType<typeof teamKpis> | null
  selected: Selected | null
  setSelected: (s: Selected | null) => void
}) {
  const rows = useMemo(
    () =>
      data.employees.map((emp) => ({
        emp,
        stats: employeeMonthStats(emp, data, months),
        sum: summarize(employeeMonthStats(emp, data, months)),
      })),
    [data, months],
  )

  const detail = useMemo(
    () => (selected ? monthDetail(selected.emp, data, selected.win.year, selected.win.month) : []),
    [selected, data],
  )

  return (
    <section className="ana-section">
      {kpis && (
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">Ø Auslastung · {kpis.monthLabel}</div>
            <div className="kpi-val">{kpis.avgPct}%</div>
          </div>
          <div className={`kpi${kpis.overloaded > 0 ? ' kpi-alert' : ''}`}>
            <div className="kpi-label">Überlastet (&gt;100%)</div>
            <div className="kpi-val">{kpis.overloaded}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Unterausgelastet (&lt;70%)</div>
            <div className="kpi-val">{kpis.underloaded}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Freie Kapazität</div>
            <div className="kpi-val">{kpis.freeDays} PT</div>
          </div>
        </div>
      )}

      <div className="ana-toolbar">
        <span className="week-toggle">
          <button className={period === '6m' ? 'active' : ''} onClick={() => setPeriod('6m')}>6 Monate</button>
          <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>Jahr</button>
        </span>
        {period === 'year' && (
          <span className="year-nav">
            <button onClick={() => setYear(year - 1)}>←</button>
            <span>{year}</span>
            <button onClick={() => setYear(year + 1)}>→</button>
          </span>
        )}
        <span className="dim heat-legend">
          <i style={{ background: '#dbeafe' }} />&lt;70
          <i style={{ background: '#dcfce7' }} />ok
          <i style={{ background: '#fef3c7' }} />knapp
          <i style={{ background: '#fee2e2' }} />&gt;100
        </span>
      </div>

      <div className="heat-scroll">
        <table className="heat">
          <thead>
            <tr>
              <th className="heat-name">Mitarbeiter</th>
              {months.map((m) => (
                <th key={`${m.year}-${m.month}`} className="num">{m.label}</th>
              ))}
              <th className="num heat-sum">Σ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ emp, stats, sum }) => (
              <tr key={emp.id}>
                <td className="heat-name">
                  {emp.name}
                  <div className="dim">{emp.weekly_hours} h</div>
                </td>
                {stats.map((s) => {
                  const c = heatColor(s.pct, s.netAvailDays > 0)
                  const isSel = !!selected && selected.emp.id === emp.id && selected.win.year === s.year && selected.win.month === s.month
                  return (
                    <td key={`${s.year}-${s.month}`} className="heat-cell">
                      <button
                        className={`heat-btn${isSel ? ' sel' : ''}`}
                        style={{ background: c.bg, color: c.fg }}
                        title={`${s.bookedDays} / ${s.netAvailDays} T${s.absenceDays ? ` · ${s.absenceDays} T abw.` : ''}`}
                        onClick={() => setSelected(isSel ? null : { emp, win: { year: s.year, month: s.month, label: s.label } })}
                      >
                        {s.netAvailDays > 0 ? `${s.pct}%` : '–'}
                      </button>
                    </td>
                  )
                })}
                <td className="num heat-sum">
                  <span className={sum.pct > 100 ? 'red' : sum.pct < 70 ? 'dim' : 'green'}>{sum.pct}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="drill">
          <div className="drill-head">
            <strong>{selected.emp.name}</strong> · {selected.win.label}
            <button className="drill-close" onClick={() => setSelected(null)}>✕</button>
          </div>
          {detail.length === 0 ? (
            <p className="muted">Keine Buchungen in diesem Monat.</p>
          ) : (
            <table className="ana-table">
              <thead>
                <tr><th>Eintrag</th><th>Art</th><th className="num">Tage</th></tr>
              </thead>
              <tbody>
                {detail.map((d) => (
                  <tr key={d.name}>
                    <td>
                      <span className="dot" style={{ background: d.color ?? '#94a3b8' }} />
                      {d.name}
                    </td>
                    <td className="dim">{d.kind === 'project' ? 'Projekt' : d.kind === 'absence' ? 'Abwesenheit' : 'Admin/intern'}</td>
                    <td className="num">{d.days} T</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
