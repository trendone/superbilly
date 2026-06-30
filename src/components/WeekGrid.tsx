import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  createBooking,
  deleteBooking,
  fetchWeek,
  updateBooking,
  type Booking,
  type BookingInput,
  type Project,
  type WeekData,
} from '../lib/data'
import { addDays, dayLabels, formatDay, isoWeek, mondayOf, toISODate } from '../lib/dates'
import { holidayName } from '../lib/holidays'
import { ABSENCE_CATEGORIES } from '../lib/analytics'
import BookingModal from './BookingModal'

type Selection = { empId: string; startISO: string; endISO: string }
type ModalState =
  | { mode: 'add'; empId: string; empName: string; start: string; end: string }
  | { mode: 'edit'; empName: string; booking: Booking }

export default function WeekGrid() {
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [weeks, setWeeks] = useState<1 | 2>(1)
  const [data, setData] = useState<WeekData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Selection | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

  // Drag-Status außerhalb des Render-Zyklus (vermeidet veraltete Closures).
  const drag = useRef<{ empId: string; anchor: string; moved: boolean } | null>(null)

  // Arbeitstage (Mo–Fr) über die sichtbaren 1 oder 2 Wochen.
  const days = useMemo(() => {
    const out: Date[] = []
    for (let w = 0; w < weeks; w++)
      for (let i = 0; i < 5; i++) out.push(addDays(monday, w * 7 + i))
    return out
  }, [monday, weeks])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchWeek(toISODate(days[0]), toISODate(days[days.length - 1]))
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false))
  }, [days])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWeek(toISODate(days[0]), toISODate(days[days.length - 1]))
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

  const isAbsence = (p: Project | undefined) =>
    !!p && p.is_system && (ABSENCE_CATEGORIES as readonly string[]).includes(p.name)

  function bookingsFor(empId: string, day: Date): Booking[] {
    const iso = toISODate(day)
    return (data?.bookings ?? []).filter(
      (b) => b.employee_id === empId && b.start_date <= iso && b.end_date >= iso,
    )
  }

  // Produktiv gebuchte Tage (ohne System-Kategorien) + Abwesenheitstage.
  // Verfügbarkeit = FTE-Anteil × (Arbeitstage − Feiertage) − Abwesenheit.
  function capacityFor(empId: string, weeklyHours: number) {
    let productive = 0
    let absence = 0
    for (const day of days) {
      for (const b of bookingsFor(empId, day)) {
        const p = projById.get(b.project_id)
        if (isAbsence(p)) absence += Number(b.budget)
        else if (!p?.is_system) productive += Number(b.budget)
      }
    }
    const workdays = days.filter((d) => !holidayName(toISODate(d))).length
    const gross = (weeklyHours / 40) * workdays
    const avail = Math.max(0, gross - absence)
    const pct = avail ? Math.round((productive / avail) * 100) : 0
    return {
      productive: Math.round(productive * 10) / 10,
      absence: Math.round(absence * 10) / 10,
      avail: Math.round(avail * 10) / 10,
      pct,
    }
  }

  const isToday = (d: Date) => toISODate(d) === toISODate(new Date())
  const inSel = (empId: string, iso: string) =>
    sel != null &&
    sel.empId === empId &&
    iso >= (sel.startISO < sel.endISO ? sel.startISO : sel.endISO) &&
    iso <= (sel.startISO > sel.endISO ? sel.startISO : sel.endISO)

  // ── Drag-Auswahl / Tap-to-Add ──────────────────────────────
  function cellDown(e: React.PointerEvent, empId: string, iso: string) {
    if ((e.target as HTMLElement).closest('.bk')) return // Karte → eigener Klick
    e.preventDefault()
    drag.current = { empId, anchor: iso, moved: false }
    setSel({ empId, startISO: iso, endISO: iso })
  }
  function cellEnter(empId: string, iso: string) {
    const d = drag.current
    if (!d || d.empId !== empId) return
    if (iso !== d.anchor) d.moved = true
    setSel({ empId, startISO: d.anchor, endISO: iso })
  }

  useEffect(() => {
    function up() {
      const d = drag.current
      if (!d) return
      const s = sel
      drag.current = null
      if (s) {
        const start = s.startISO < s.endISO ? s.startISO : s.endISO
        const end = s.startISO > s.endISO ? s.startISO : s.endISO
        const emp = data?.employees.find((x) => x.id === d.empId)
        setModal({ mode: 'add', empId: d.empId, empName: emp?.name ?? '', start, end })
      }
      setSel(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [sel, data])

  function openEdit(b: Booking, empName: string) {
    if (b.locked) return
    setModal({ mode: 'edit', empName, booking: b })
  }

  async function handleSave(input: BookingInput) {
    if (modal?.mode === 'edit') await updateBooking(modal.booking.id, input)
    else if (modal?.mode === 'add') await createBooking({ ...input, employee_id: modal.empId })
    setModal(null)
    await load()
  }
  async function handleDelete() {
    if (modal?.mode !== 'edit') return
    await deleteBooking(modal.booking.id)
    setModal(null)
    await load()
  }

  const lastMonday = addDays(monday, (weeks - 1) * 7)
  const weekLabel =
    weeks === 1
      ? `KW ${isoWeek(monday)} · ${formatDay(days[0])}–${formatDay(days[4])}`
      : `KW ${isoWeek(monday)}–${isoWeek(lastMonday)} · ${formatDay(days[0])}–${formatDay(days[days.length - 1])}`

  return (
    <div className="grid-wrap">
      <div className="week-nav">
        <button onClick={() => setMonday(addDays(monday, -7 * weeks))} title="Zurück">←</button>
        <span className="week-label">{weekLabel}</span>
        <button onClick={() => setMonday(addDays(monday, 7 * weeks))} title="Weiter">→</button>
        <button className="today" onClick={() => setMonday(mondayOf(new Date()))}>Heute</button>
        <span className="week-toggle">
          <button className={weeks === 1 ? 'active' : ''} onClick={() => setWeeks(1)}>
            1 Woche
          </button>
          <button className={weeks === 2 ? 'active' : ''} onClick={() => setWeeks(2)}>
            2 Wochen
          </button>
        </span>
      </div>

      {error && <div className="status err">✕ {error}</div>}
      {loading && !data && <div className="status pending">… lädt</div>}

      {data && (
        <div className="grid-scroll">
        <div
          className="grid"
          style={
            {
              gridTemplateColumns: `var(--name-w, 220px) repeat(${days.length}, minmax(var(--col-min, 0px), 1fr))`,
            } as CSSProperties
          }
        >
          <div className="gh corner">Mitarbeiter</div>
          {days.map((d, i) => {
            const hol = holidayName(toISODate(d))
            return (
              <div
                key={i}
                className={`gh${isToday(d) ? ' is-today' : ''}${hol ? ' is-holiday' : ''}${
                  weeks === 2 && i === 5 ? ' week-sep' : ''
                }`}
                title={hol ?? undefined}
              >
                {dayLabels[i % 5]} <span>{formatDay(d)}</span>
                {hol && <span className="holiday-tag">{hol}</span>}
              </div>
            )
          })}

          {data.employees.map((emp) => {
            const cap = capacityFor(emp.id, Number(emp.weekly_hours))
            const over = cap.pct > 100
            return (
              <Fragment key={emp.id}>
                <div className="gc emp">
                  <div className="emp-name">{emp.name}</div>
                  <div className="emp-cap">
                    {cap.productive} / {cap.avail} Tage · {cap.pct}%
                    {cap.absence > 0 && <span className="emp-abs"> · {cap.absence} T abw.</span>}
                  </div>
                  <div className="cap-bar">
                    <span
                      style={{
                        width: `${Math.min(cap.pct, 100)}%`,
                        background: over ? 'var(--red)' : undefined,
                      }}
                    />
                  </div>
                </div>

                {days.map((day, i) => {
                  const iso = toISODate(day)
                  return (
                  <div
                    key={i}
                    className={`gc cell editable${isToday(day) ? ' is-today' : ''}${
                      holidayName(iso) ? ' is-holiday' : ''
                    }${weeks === 2 && i === 5 ? ' week-sep' : ''}${inSel(emp.id, iso) ? ' cell-sel' : ''}`}
                    onPointerDown={(e) => cellDown(e, emp.id, iso)}
                    onPointerEnter={() => cellEnter(emp.id, iso)}
                  >
                    {bookingsFor(emp.id, day).map((b) => {
                      const p = projById.get(b.project_id)
                      const color = p?.color ?? '#94a3b8'
                      return (
                        <div
                          key={b.id}
                          className="bk"
                          style={{ borderLeftColor: color, background: `${color}22` }}
                          title={b.locked ? `${p?.name ?? ''} (gesperrt)` : p?.name}
                          onClick={(e) => {
                            e.stopPropagation()
                            openEdit(b, emp.name)
                          }}
                        >
                          <div className="bk-name">{p?.name ?? '—'}</div>
                          <div className="bk-sub">
                            {b.note ?? (Number(b.budget) === 0.5 ? '½ Tag' : '1 Tag')}
                          </div>
                        </div>
                      )
                    })}
                    <div className="cell-add-hint">+</div>
                  </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
        </div>
      )}

      {modal && data && (
        <BookingModal
          employeeName={modal.empName}
          projects={data.projects}
          initial={modal.mode === 'edit' ? modal.booking : undefined}
          defaultStart={modal.mode === 'add' ? modal.start : undefined}
          defaultEnd={modal.mode === 'add' ? modal.end : undefined}
          onSave={handleSave}
          onDelete={modal.mode === 'edit' ? handleDelete : undefined}
          onCancel={() => setModal(null)}
        />
      )}

      <p className="hint">
        Zelle ziehen oder antippen zum Planen · Buchung anklicken zum Bearbeiten ·{' '}
        {data?.employees.length ?? 0} Mitarbeiter
      </p>
    </div>
  )
}
