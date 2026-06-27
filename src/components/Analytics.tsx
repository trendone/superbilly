import { useEffect, useMemo, useState } from 'react'
import {
  employeeMonthStats,
  fetchAnalytics,
  monthWindow,
  projectStats,
  type AnalyticsData,
} from '../lib/analytics'

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' })
function fmtRange(start: string | null, end: string | null): string {
  if (!start || !end) return '–'
  const s = dateFmt.format(new Date(`${start}T00:00:00`))
  const e = dateFmt.format(new Date(`${end}T00:00:00`))
  return `${s} – ${e}`
}

/** Farbklasse für Auslastungs-Prozent (grün ok, gelb knapp, rot über 100). */
function pctTone(pct: number): string {
  if (pct > 100) return 'red'
  if (pct > 79) return 'amber'
  return 'green'
}

type SubTab = 'projekte' | 'mitarbeiter'

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sub, setSub] = useState<SubTab>('projekte')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAnalytics()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message ?? String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const projects = useMemo(() => (data ? projectStats(data) : []), [data])
  const months = useMemo(() => monthWindow(new Date(), -2, 3), [])

  return (
    <div className="analytics">
      <div className="sub-tabs">
        <button
          className={`tab${sub === 'projekte' ? ' active' : ''}`}
          onClick={() => setSub('projekte')}
        >
          📊 Projekte
        </button>
        <button
          className={`tab${sub === 'mitarbeiter' ? ' active' : ''}`}
          onClick={() => setSub('mitarbeiter')}
        >
          👥 Mitarbeiter
        </button>
      </div>

      {error && <div className="status err">✕ {error}</div>}
      {loading && <div className="status pending">… lädt</div>}

      {data && sub === 'projekte' && (
        <section className="ana-section">
          {projects.length === 0 ? (
            <p className="muted">Keine Projekte vorhanden.</p>
          ) : (
            <table className="ana-table">
              <thead>
                <tr>
                  <th>Projekt</th>
                  <th className="num">Gebucht</th>
                  <th className="num">Budget</th>
                  <th className="num">Differenz</th>
                  <th>Zeitraum</th>
                  <th>Mitarbeiter</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const diffTone =
                    p.diffDays == null ? '' : p.diffDays < 0 ? 'red' : p.diffDays === 0 ? 'amber' : 'green'
                  return (
                    <tr key={p.project.id}>
                      <td>
                        <span className="dot" style={{ background: p.project.color ?? '#94a3b8' }} />
                        {p.project.name}
                      </td>
                      <td className="num">{p.bookedDays} T</td>
                      <td className="num">{p.budgetDays != null ? `${p.budgetDays} T` : '–'}</td>
                      <td className={`num ${diffTone}`}>
                        {p.diffDays == null ? '–' : `${p.diffDays >= 0 ? '+' : ''}${p.diffDays} T`}
                      </td>
                      <td className="dim">{fmtRange(p.rangeStart, p.rangeEnd)}</td>
                      <td className="dim">{p.employeeNames.join(', ') || '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {data && sub === 'mitarbeiter' && (
        <section className="ana-section">
          {data.employees.length === 0 ? (
            <p className="muted">Keine Mitarbeiter vorhanden.</p>
          ) : (
            data.employees.map((emp) => {
              const stats = employeeMonthStats(emp, data, months)
              return (
                <div key={emp.id} className="emp-block">
                  <h3>
                    {emp.name} <span className="dim">({emp.weekly_hours} h/Woche)</span>
                  </h3>
                  <table className="ana-table">
                    <thead>
                      <tr>
                        <th>Monat</th>
                        <th className="num">Auslastung</th>
                        <th className="num">Abwesend</th>
                        <th className="num">Admin</th>
                        <th>Projekte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((s) => (
                        <tr key={s.label}>
                          <td>{s.label}</td>
                          <td className="num">
                            <span className={`pct ${pctTone(s.pct)}`}>{s.pct}%</span>{' '}
                            <span className="dim">
                              ({s.bookedHours}/{s.netCapacityHours} h)
                            </span>
                          </td>
                          <td className="num dim">
                            {s.absenceDays > 0 ? `${s.absenceDays} T (${s.absenceHours} h)` : '–'}
                          </td>
                          <td className="num dim">{s.adminDays > 0 ? `${s.adminDays} T` : '–'}</td>
                          <td className="dim">{s.projectNames.join(', ') || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}
        </section>
      )}
    </div>
  )
}
