import { Fragment, useEffect, useMemo, useState } from 'react'
import { fetchWeek, type Booking, type Project, type WeekData } from '../lib/data'
import { addDays, dayLabels, formatDay, isoWeek, mondayOf, toISODate } from '../lib/dates'

export default function WeekGrid() {
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState<WeekData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(monday, i)), [monday])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWeek(toISODate(days[0]), toISODate(days[4]))
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message ?? String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [days])

  const projById = useMemo(() => {
    const m = new Map<string, Project>()
    data?.projects.forEach((p) => m.set(p.id, p))
    return m
  }, [data])

  function bookingsFor(empId: string, day: Date): Booking[] {
    const iso = toISODate(day)
    return (data?.bookings ?? []).filter(
      (b) => b.employee_id === empId && b.start_date <= iso && b.end_date >= iso,
    )
  }

  function bookedDays(empId: string): number {
    let sum = 0
    for (const day of days) for (const b of bookingsFor(empId, day)) sum += Number(b.budget)
    return sum
  }

  const isToday = (d: Date) => toISODate(d) === toISODate(new Date())

  return (
    <div className="grid-wrap">
      <div className="week-nav">
        <button onClick={() => setMonday(addDays(monday, -7))} title="Vorherige Woche">←</button>
        <span className="week-label">
          KW {isoWeek(monday)} · {formatDay(days[0])}–{formatDay(days[4])}
        </span>
        <button onClick={() => setMonday(addDays(monday, 7))} title="Nächste Woche">→</button>
        <button className="today" onClick={() => setMonday(mondayOf(new Date()))}>Heute</button>
      </div>

      {error && <div className="status err">✕ {error}</div>}
      {loading && !data && <div className="status pending">… lädt</div>}

      {data && (
        <div className="grid" style={{ gridTemplateColumns: '220px repeat(5, 1fr)' }}>
          <div className="gh corner">Mitarbeiter</div>
          {days.map((d, i) => (
            <div key={i} className={`gh${isToday(d) ? ' is-today' : ''}`}>
              {dayLabels[i]} <span>{formatDay(d)}</span>
            </div>
          ))}

          {data.employees.map((emp) => {
            const avail = Number(emp.weekly_hours) / 8
            const booked = bookedDays(emp.id)
            const pct = avail ? Math.round((booked / avail) * 100) : 0
            const over = pct > 100
            return (
              <Fragment key={emp.id}>
                <div className="gc emp">
                  <div className="emp-name">{emp.name}</div>
                  <div className="emp-cap">
                    {booked} / {avail} Tage · {pct}%
                  </div>
                  <div className="cap-bar">
                    <span
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        background: over ? 'var(--red)' : undefined,
                      }}
                    />
                  </div>
                </div>

                {days.map((day, i) => (
                  <div key={i} className={`gc cell${isToday(day) ? ' is-today' : ''}`}>
                    {bookingsFor(emp.id, day).map((b) => {
                      const p = projById.get(b.project_id)
                      const color = p?.color ?? '#94a3b8'
                      return (
                        <div
                          key={b.id}
                          className="bk"
                          style={{ borderLeftColor: color, background: `${color}22` }}
                          title={p?.name}
                        >
                          <div className="bk-name">{p?.name ?? '—'}</div>
                          <div className="bk-sub">
                            {b.note ?? (Number(b.budget) === 0.5 ? '½ Tag' : '1 Tag')}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </Fragment>
            )
          })}
        </div>
      )}

      <p className="hint">
        Dev-Seed · nur Lesen (Bearbeiten kommt mit Login) · {data?.employees.length ?? 0} Mitarbeiter
      </p>
    </div>
  )
}
