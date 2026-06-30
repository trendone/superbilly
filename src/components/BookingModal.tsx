import { useEffect, useMemo, useState } from 'react'
import {
  employeeDayLoads,
  projectBookedDays,
  type Booking,
  type BookingInput,
  type Project,
} from '../lib/data'
import { ABSENCE_CATEGORIES, STANDARD_DAY_RATE } from '../lib/analytics'
import { holidayName } from '../lib/holidays'
import { addDays, formatDay, toISODate } from '../lib/dates'

/**
 * Anlegen/Bearbeiten einer Planungs-Buchung – portiert das Task-Modal der alten
 * Billy-App: Projekt (Projekte + System-Kategorien gruppiert), Zeitraum,
 * ½/1-Tag-Toggle, Notiz, Live-Hinweis zum Budget-Rest.
 */
export default function BookingModal({
  employeeName,
  employeeId,
  dailyCapacity,
  projects,
  initial,
  defaultStart,
  defaultEnd,
  onSave,
  onDelete,
  onCancel,
}: {
  employeeName: string
  employeeId: string
  dailyCapacity: number
  projects: Project[]
  initial?: Booking
  defaultStart?: string
  defaultEnd?: string
  onSave: (input: BookingInput) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel: () => void
}) {
  const [projectId, setProjectId] = useState(initial?.project_id ?? '')
  const [start, setStart] = useState(initial?.start_date ?? defaultStart ?? '')
  const [end, setEnd] = useState(initial?.end_date ?? defaultEnd ?? defaultStart ?? '')
  const [budget, setBudget] = useState<number>(initial ? Number(initial.budget) : 0.5)
  const [note, setNote] = useState(initial?.note ?? '')
  const [isWorkshop, setIsWorkshop] = useState(initial?.is_workshop ?? false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [booked, setBooked] = useState<number | null>(null)
  const [dayWarn, setDayWarn] = useState<{ date: string; total: number; avail: number } | null>(null)

  // Projekte vs. System-Kategorien für die gruppierte Auswahl.
  const { real, system } = useMemo(() => {
    const real: Project[] = []
    const system: Project[] = []
    for (const p of [...projects].sort((a, b) => a.name.localeCompare(b.name)))
      (p.is_system ? system : real).push(p)
    return { real, system }
  }, [projects])

  const absenceIds = useMemo(
    () =>
      new Set(
        projects
          .filter((p) => p.is_system && (ABSENCE_CATEGORIES as readonly string[]).includes(p.name))
          .map((p) => p.id),
      ),
    [projects],
  )

  const selected = projects.find((p) => p.id === projectId)
  const isAbsenceProject = !!projectId && absenceIds.has(projectId)

  // Budget-Tage des gewählten Projekts (explizit oder aus € / Tagessatz abgeleitet).
  const budgetDays = useMemo(() => {
    if (!selected || selected.is_system) return null
    if (selected.budget_days != null) return selected.budget_days
    if (selected.budget_eur != null) {
      const rate = selected.day_rate_eur ?? STANDARD_DAY_RATE
      return rate > 0 ? Math.round(selected.budget_eur / rate) : null
    }
    return null
  }, [selected])

  // Bereits verplante Tage laden, sobald ein Projekt mit Budget gewählt ist.
  useEffect(() => {
    let cancelled = false
    setBooked(null)
    if (!projectId || budgetDays == null) return
    projectBookedDays(projectId, initial?.id)
      .then((d) => !cancelled && setBooked(d))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, budgetDays, initial?.id])

  // Tages-Überbuchung prüfen: pro Arbeitstag im Zeitraum würde diese Buchung
  // die (um Abwesenheit reduzierte) Tageskapazität übersteigen. Nur warnen.
  useEffect(() => {
    let cancelled = false
    setDayWarn(null)
    if (!projectId || isAbsenceProject || !start || !end || end < start) return
    employeeDayLoads(employeeId, start, end, absenceIds, initial?.id)
      .then((loads) => {
        if (cancelled) return
        let worst: { date: string; total: number; avail: number } | null = null
        let d = new Date(`${start}T00:00:00`)
        const last = new Date(`${end}T00:00:00`)
        while (d <= last) {
          const iso = toISODate(d)
          const wd = d.getDay()
          if (wd !== 0 && wd !== 6) {
            const lo = loads[iso] ?? { work: 0, absence: 0 }
            const cap = holidayName(iso) ? 0 : dailyCapacity
            const avail = Math.max(0, cap - lo.absence)
            const total = Math.round((lo.work + budget) * 10) / 10
            if (total > avail + 1e-9 && (!worst || total - avail > worst.total - worst.avail))
              worst = { date: iso, total, avail: Math.round(avail * 10) / 10 }
          }
          d = addDays(d, 1)
        }
        setDayWarn(worst)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, isAbsenceProject, start, end, budget, employeeId, absenceIds, dailyCapacity, initial?.id])

  function onStartChange(v: string) {
    setStart(v)
    if (end < v) setEnd(v)
  }
  function onEndChange(v: string) {
    setEnd(v)
    if (v < start) setStart(v)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) return setErr('Bitte ein Projekt wählen.')
    if (!start || !end) return setErr('Bitte einen Zeitraum wählen.')
    if (end < start) return setErr('Enddatum muss nach Startdatum liegen.')
    setSaving(true)
    setErr(null)
    try {
      await onSave({
        employee_id: initial?.employee_id ?? '',
        project_id: projectId,
        start_date: start,
        end_date: end,
        budget,
        note: note.trim() || null,
        is_workshop: isWorkshop,
      })
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  const remaining = budgetDays != null && booked != null ? budgetDays - booked : null

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-head">
          <span className="modal-title">{initial ? 'Buchung bearbeiten' : 'Buchung hinzufügen'}</span>
          <button className="modal-x" onClick={onCancel} aria-label="Schließen">✕</button>
        </div>
        <form className="ms-form" onSubmit={submit}>
          <div className="modal-emp">{employeeName}</div>
          <div className="ms-form-grid">
            <label>
              Projekt
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} autoFocus>
                <option value="">— Projekt wählen —</option>
                {system.length > 0 && (
                  <optgroup label="Abwesenheit / Intern">
                    {system.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {real.length > 0 && (
                  <optgroup label="Projekte">
                    {real.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.client ? ` (${p.client})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              Von
              <input type="date" value={start} onChange={(e) => onStartChange(e.target.value)} />
            </label>
            <label>
              Bis
              <input type="date" value={end} onChange={(e) => onEndChange(e.target.value)} />
            </label>
            <label>
              Notiz
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
            </label>
          </div>

          <div className="budget-toggle">
            <button
              type="button"
              className={budget === 0.5 ? 'active' : ''}
              onClick={() => setBudget(0.5)}
            >
              ½ Tag
            </button>
            <button
              type="button"
              className={budget === 1 ? 'active' : ''}
              onClick={() => setBudget(1)}
            >
              1 Tag
            </button>
          </div>

          <label className="workshop-check">
            <input
              type="checkbox"
              checked={isWorkshop}
              onChange={(e) => setIsWorkshop(e.target.checked)}
            />
            Workshop
          </label>

          {dayWarn && (
            <div className="budget-info over">
              ⚠ Tag überbucht ({formatDay(new Date(`${dayWarn.date}T00:00:00`))}): {dayWarn.total} /{' '}
              {dayWarn.avail} Tag verplant
            </div>
          )}

          {remaining != null && (
            <div className={`budget-info ${remaining <= 0 ? 'over' : 'ok'}`}>
              {remaining <= 0
                ? `⚠ Budget erschöpft: ${booked} / ${budgetDays} Tage verplant (${Math.abs(remaining)} überbucht)`
                : `✓ ${remaining} von ${budgetDays} Tagen frei (${booked} verplant)`}
            </div>
          )}

          {err && <div className="status err">✕ {err}</div>}

          <div className="ms-form-actions">
            {initial && onDelete && (
              <button
                type="button"
                className="btn-danger"
                style={{ marginRight: 'auto' }}
                disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await onDelete()
                  } catch (e) {
                    setErr((e as Error).message)
                    setSaving(false)
                  }
                }}
              >
                Löschen
              </button>
            )}
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichert…' : 'Speichern'}
            </button>
            <button type="button" className="btn-ghost" onClick={onCancel}>
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
