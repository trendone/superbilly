import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  createBooking,
  deleteBooking,
  fetchEmployeesRangeBookings,
  fetchProjectMeta,
  fetchProjectRangeBookings,
  type Booking,
  type ProjectMeta,
} from '../lib/data'
import {
  addDays,
  addMonths,
  formatDay,
  formatMonth,
  isoWeek,
  mondayOf,
  startOfMonth,
  toISODate,
  weekdayLabel,
  workingDaysOfMonth,
} from '../lib/dates'
import { holidayName } from '../lib/holidays'
import { ABSENCE_CATEGORIES, isReservedProject } from '../lib/analytics'

/**
 * Projekt-gebundene Schnellplanung: Das Projekt ist fix (es ist die Detailseite),
 * gewählt wird nur noch Mitarbeiter (Zeile) und Tag. Kein Modal, keine erneute
 * Projektauswahl – ein Klick bzw. Ziehen legt sofort eine Buchung an, ein Klick
 * auf eine Kachel entfernt sie. Gedacht für stark fragmentierte Projekte, bei
 * denen das buchungs-zentrierte Wochenraster mühsam ist.
 */

/** Sichtbares Zeitfenster: 1 oder 2 Wochen bzw. der ganze Monat. */
type PlanMode = 1 | 2 | 'month'

/** Sprungziel aus der „Wann verplant"-Liste der Detailseite. `nonce` sorgt
 *  dafür, dass auch ein erneuter Klick auf dasselbe Datum wieder springt. */
export interface PlanFocus {
  iso: string
  nonce: number
}

/** Trennlinie zum Wochenanfang – im Monatsraster für jede neue Woche, im
 *  2-Wochen-Fenster für die zweite Woche. */
function isWeekStart(d: Date, i: number): boolean {
  return i > 0 && d.getDay() === 1
}

export default function ProjectPlanGrid({
  projectId,
  displayProjectIds,
  projectColor,
  employees,
  initialEmployeeIds,
  focus,
  onChanged,
}: {
  /** Buchungs-Ziel (das aktuell betrachtete Projekt). */
  projectId: string
  /** IDs, deren Buchungen angezeigt werden – inkl. verknüpftem Zoho-Projekt. */
  displayProjectIds: string[]
  projectColor: string | null
  /** Alle Mitarbeitenden (für den „+ Mitarbeiter"-Picker). */
  employees: { id: string; name: string }[]
  /** Mitarbeitende, die schon auf dem Projekt sind – Startzeilen. */
  initialEmployeeIds: string[]
  /** Optionales Sprungziel: blättert das Raster auf diesen Tag. */
  focus?: PlanFocus | null
  /** Nach jeder Änderung: Budget-/KPI-Anzeige der Detailseite auffrischen. */
  onChanged: () => void
}) {
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()))
  const [mode, setMode] = useState<PlanMode>(2)
  const [brush, setBrush] = useState<0.5 | 1>(1)
  const [rows, setRows] = useState<string[]>(() => [...initialEmployeeIds])
  const [bookings, setBookings] = useState<Booking[]>([])
  // Projektübergreifende Buchungen der Zeilen-Mitarbeiter (andere Projekte,
  // Abwesenheit) – nur zur Anzeige der Belegung, nicht editierbar.
  const [foreign, setForeign] = useState<Booking[]>([])
  const [projMeta, setProjMeta] = useState<Map<string, ProjectMeta>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [sel, setSel] = useState<{ empId: string; startISO: string; endISO: string } | null>(null)
  const drag = useRef<{ empId: string; anchor: string; moved: boolean } | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)

  const empName = useMemo(() => {
    const m = new Map<string, string>()
    employees.forEach((e) => m.set(e.id, e.name))
    return m
  }, [employees])

  // Arbeitstage (Mo–Fr) des sichtbaren Fensters: 1/2 Wochen oder ganzer Monat.
  const days = useMemo(() => {
    if (mode === 'month') return workingDaysOfMonth(monthStart)
    const out: Date[] = []
    for (let w = 0; w < mode; w++) for (let i = 0; i < 5; i++) out.push(addDays(monday, w * 7 + i))
    return out
  }, [monday, monthStart, mode])

  // Sprungziel aus der „Wann verplant"-Liste: Fenster auf den Tag legen und
  // das Raster in den Blick scrollen.
  useEffect(() => {
    if (!focus) return
    const d = new Date(`${focus.iso}T00:00:00`)
    setMonday(mondayOf(d))
    setMonthStart(startOfMonth(d))
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])

  const color = projectColor ?? '#7c6dfa'
  const fromISO = toISODate(days[0])
  const toISO = toISODate(days[days.length - 1])

  const load = useCallback(() => {
    setError(null)
    return fetchProjectRangeBookings(displayProjectIds, fromISO, toISO)
      .then(setBookings)
      .catch((e) => setError(e.message ?? String(e)))
  }, [displayProjectIds, fromISO, toISO])

  useEffect(() => {
    let cancelled = false
    fetchProjectRangeBookings(displayProjectIds, fromISO, toISO)
      .then((b) => !cancelled && setBookings(b))
      .catch((e) => !cancelled && setError(e.message ?? String(e)))
    return () => {
      cancelled = true
    }
  }, [displayProjectIds, fromISO, toISO])

  // Mitarbeitende mit Buchung im Fenster, die (noch) keine Zeile haben, ergänzen –
  // so tauchen auch anderswo Verplante auf, sobald man in ihren Zeitraum blättert.
  useEffect(() => {
    const extra = [...new Set(bookings.map((b) => b.employee_id))].filter((id) => !rows.includes(id))
    if (extra.length) setRows((r) => [...r, ...extra])
  }, [bookings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Projekt-Metadaten (einmalig) zum Klassifizieren/Beschriften fremder Buchungen.
  useEffect(() => {
    let cancelled = false
    fetchProjectMeta()
      .then((list) => !cancelled && setProjMeta(new Map(list.map((p) => [p.id, p]))))
      .catch((e) => !cancelled && setError(e.message ?? String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  // Projektübergreifende Belegung der sichtbaren Mitarbeitenden (ohne dieses
  // Projekt – dessen Buchungen kommen aus `bookings`).
  useEffect(() => {
    let cancelled = false
    fetchEmployeesRangeBookings(rows, fromISO, toISO)
      .then((b) => {
        if (cancelled) return
        setForeign(b.filter((x) => !displayProjectIds.includes(x.project_id)))
      })
      .catch((e) => !cancelled && setError(e.message ?? String(e)))
    return () => {
      cancelled = true
    }
  }, [rows, fromISO, toISO, displayProjectIds])

  function bookingsFor(empId: string, iso: string): Booking[] {
    return bookings.filter(
      (b) => b.employee_id === empId && b.start_date <= iso && b.end_date >= iso,
    )
  }

  // Auf diesem Projekt im Fenster verplante Tage je Mitarbeiter (Mo–Fr × budget).
  function plannedDays(empId: string): number {
    let total = 0
    for (const day of days) {
      const iso = toISODate(day)
      for (const b of bookingsFor(empId, iso)) total += Number(b.budget)
    }
    return Math.round(total * 10) / 10
  }

  // Fremdbuchungen (andere Projekte / Abwesenheit) an einem Tag.
  function foreignFor(empId: string, iso: string): Booking[] {
    return foreign.filter(
      (b) => b.employee_id === empId && b.start_date <= iso && b.end_date >= iso,
    )
  }
  const isAbsenceMeta = (m?: ProjectMeta) =>
    !!m && m.is_system && (ABSENCE_CATEGORIES as readonly string[]).includes(m.name)
  // Kurzes Label + Klasse für eine Fremdbuchung.
  function foreignInfo(b: Booking): { label: string; cls: string } {
    const m = projMeta.get(b.project_id)
    if (isAbsenceMeta(m)) return { label: m!.name, cls: 'bk-foreign bk-foreign-abs' }
    if (isReservedProject(m)) return { label: m?.name ?? 'vorgemerkt', cls: 'bk-foreign bk-foreign-resv' }
    return { label: m?.name ?? 'Belegt', cls: 'bk-foreign' }
  }

  // Tages-Überbuchung: Arbeitsbudget (dieses Projekt + fremde, ohne Abwesenheit &
  // ohne vorgemerkt) übersteigt die um Abwesenheit/Feiertag reduzierte Kapazität.
  function dayOverload(empId: string, iso: string): number | null {
    let work = 0
    let absence = 0
    for (const b of bookingsFor(empId, iso)) work += Number(b.budget)
    for (const b of foreignFor(empId, iso)) {
      const m = projMeta.get(b.project_id)
      if (isReservedProject(m)) continue
      if (isAbsenceMeta(m)) absence += Number(b.budget)
      else work += Number(b.budget)
    }
    const cap = holidayName(iso) ? 0 : 1
    const avail = Math.max(0, cap - absence)
    return work > avail + 1e-9 ? Math.round(work * 10) / 10 : null
  }

  async function persist(fn: () => Promise<unknown>) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function createRange(empId: string, startISO: string, endISO: string) {
    void persist(() =>
      createBooking({
        employee_id: empId,
        project_id: projectId,
        start_date: startISO,
        end_date: endISO,
        budget: brush,
        note: null,
        is_workshop: false,
      }),
    )
  }

  function removeBooking(b: Booking) {
    if (b.locked) return
    void persist(() => deleteBooking(b.id))
  }

  // ── Drag-Auswahl / Tap-to-Add (wie im Wochenraster) ─────────────
  function cellDown(e: React.PointerEvent, empId: string, iso: string) {
    if (saving) return
    if ((e.target as HTMLElement).closest('.bk')) return // Kachel → eigener Klick
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
      const s = sel
      drag.current = null
      if (d && s) {
        const start = s.startISO < s.endISO ? s.startISO : s.endISO
        const end = s.startISO > s.endISO ? s.startISO : s.endISO
        createRange(d.empId, start, end)
      }
      setSel(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const inSel = (empId: string, iso: string) =>
    sel != null &&
    sel.empId === empId &&
    iso >= (sel.startISO < sel.endISO ? sel.startISO : sel.endISO) &&
    iso <= (sel.startISO > sel.endISO ? sel.startISO : sel.endISO)

  const availableToAdd = employees.filter((e) => !rows.includes(e.id))
  const isMonth = mode === 'month'
  const lastMonday = addDays(monday, (mode === 2 ? 1 : 0) * 7)
  const rangeLabel = isMonth
    ? `${formatMonth(monthStart)} · ${days.length} Werktage`
    : mode === 1
      ? `KW ${isoWeek(monday)} · ${formatDay(days[0])}–${formatDay(days[4])}`
      : `KW ${isoWeek(monday)}–${isoWeek(lastMonday)} · ${formatDay(days[0])}–${formatDay(days[days.length - 1])}`

  /** Ein Fenster vor/zurück – je nach Modus Wochen oder Monate. */
  function shift(dir: -1 | 1) {
    if (isMonth) setMonthStart((m) => addMonths(m, dir))
    else setMonday((m) => addDays(m, dir * 7 * mode))
  }
  function jumpToday() {
    setMonday(mondayOf(new Date()))
    setMonthStart(startOfMonth(new Date()))
  }
  /** Moduswechsel behält den betrachteten Zeitraum bei, statt auf heute zu springen. */
  function switchMode(next: PlanMode) {
    if (next === mode) return
    if (next === 'month') {
      // Mitte des Fensters, nicht dessen Start – ein 2-Wochen-Fenster über den
      // Monatswechsel soll im „gefühlt" betrachteten Monat landen.
      setMonthStart(startOfMonth(days[Math.floor(days.length / 2)]))
    } else if (isMonth) {
      const now = new Date()
      const showsThisMonth = startOfMonth(now).getTime() === monthStart.getTime()
      setMonday(mondayOf(showsThisMonth ? now : days[0]))
    }
    setMode(next)
  }

  return (
    <section ref={sectionRef} className={`ms-group plan-grid${isMonth ? ' plan-month' : ''}`}>
      <h3 className="ms-group-title">Schnellplanung</h3>
      <p className="hint plan-hint">
        Projekt ist gesetzt – nur noch Mitarbeiter-Zeile &amp; Tage wählen. Tag klicken oder ziehen
        zum Verplanen, Kachel klicken zum Entfernen. Pinsel bestimmt ganze/halbe Tage.
      </p>

      <div className="week-nav plan-nav">
        <button onClick={() => shift(-1)} title="Zurück">←</button>
        <span className="week-label">{rangeLabel}</span>
        <button onClick={() => shift(1)} title="Weiter">→</button>
        <button className="today" onClick={jumpToday}>Heute</button>
        <span className="week-toggle">
          <button className={mode === 1 ? 'active' : ''} onClick={() => switchMode(1)}>1 Woche</button>
          <button className={mode === 2 ? 'active' : ''} onClick={() => switchMode(2)}>2 Wochen</button>
          <button className={isMonth ? 'active' : ''} onClick={() => switchMode('month')}>Monat</button>
        </span>
      </div>

      <div className="budget-toggle plan-brush">
        <span className="plan-brush-label">Pinsel:</span>
        <button className={brush === 0.5 ? 'active' : ''} onClick={() => setBrush(0.5)}>½ Tag</button>
        <button className={brush === 1 ? 'active' : ''} onClick={() => setBrush(1)}>1 Tag</button>
      </div>

      {error && <div className="status err">✕ {error}</div>}

      <div className="grid-scroll">
        <div
          className="grid"
          style={
            {
              gridTemplateColumns: `var(--name-w, 200px) repeat(${days.length}, minmax(${
                isMonth ? 'var(--month-col-min, 54px)' : 'var(--col-min, 0px)'
              }, 1fr))`,
            } as CSSProperties
          }
        >
          <div className="gh corner">Mitarbeiter</div>
          {days.map((d, i) => {
            const hol = holidayName(toISODate(d))
            return (
              <div
                key={i}
                className={`gh${toISODate(d) === toISODate(new Date()) ? ' is-today' : ''}${
                  hol ? ' is-holiday' : ''
                }${isWeekStart(d, i) ? ' week-sep' : ''}`}
                title={hol ?? undefined}
              >
                {weekdayLabel(d)} <span>{formatDay(d)}</span>
                {hol && <span className="holiday-tag">{hol}</span>}
              </div>
            )
          })}

          {rows.length === 0 && (
            <div className="gc plan-empty" style={{ gridColumn: '1 / -1' }}>
              Noch niemand verplant – unten Mitarbeiter hinzufügen.
            </div>
          )}

          {rows.map((empId) => {
            const planned = plannedDays(empId)
            return (
              <Fragment key={empId}>
                <div className="gc emp">
                  <div className="emp-name">{empName.get(empId) ?? '—'}</div>
                  <div className="emp-cap">{planned} Tage im Zeitraum</div>
                </div>
                {days.map((day, i) => {
                  const iso = toISODate(day)
                  const dayBookings = bookingsFor(empId, iso)
                  const foreignDay = foreignFor(empId, iso)
                  const over = dayOverload(empId, iso)
                  return (
                    <div
                      key={i}
                      className={`gc cell editable${
                        toISODate(day) === toISODate(new Date()) ? ' is-today' : ''
                      }${holidayName(iso) ? ' is-holiday' : ''}${
                        isWeekStart(day, i) ? ' week-sep' : ''
                      }${inSel(empId, iso) ? ' cell-sel' : ''}${over != null ? ' cell-over' : ''}`}
                      onPointerDown={(e) => cellDown(e, empId, iso)}
                      onPointerEnter={() => cellEnter(empId, iso)}
                    >
                      {over != null && (
                        <span className="cell-over-badge" title="Tag überbucht">⚠ {over} T</span>
                      )}
                      {foreignDay.map((b) => {
                        const { label, cls } = foreignInfo(b)
                        return (
                          <div
                            key={b.id}
                            className={`${cls} ${Number(b.budget) === 0.5 ? 'bk-half' : 'bk-full'}`}
                            title={`${label} — bereits verplant (${Number(b.budget) === 0.5 ? '½' : '1'} Tag)`}
                          >
                            <div className="bk-sub">{label}</div>
                          </div>
                        )
                      })}
                      {dayBookings.map((b) => (
                        <div
                          key={b.id}
                          className={`bk ${Number(b.budget) === 0.5 ? 'bk-half' : 'bk-full'}`}
                          style={{
                            borderLeftColor: color,
                            background: `${color}22`,
                            cursor: b.locked ? 'default' : 'pointer',
                          }}
                          title={b.locked ? 'Gesperrt (Zoho-Sync)' : 'Klicken zum Entfernen'}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeBooking(b)
                          }}
                        >
                          <div className="bk-sub">
                            {b.locked ? '🔒 ' : ''}
                            {Number(b.budget) === 0.5 ? '½ Tag' : '1 Tag'}
                          </div>
                        </div>
                      ))}
                      {dayBookings.length === 0 && foreignDay.length === 0 && (
                        <div className="cell-add-hint">+</div>
                      )}
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      </div>

      {availableToAdd.length > 0 && (
        <div className="plan-add-emp">
          <label>
            + Mitarbeiter{' '}
            <select
              className="field-inline"
              value=""
              onChange={(e) => {
                if (e.target.value) setRows((r) => [...r, e.target.value])
              }}
            >
              <option value="">— wählen —</option>
              {availableToAdd.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {saving && <span className="dim">… speichert</span>}
        </div>
      )}
    </section>
  )
}
