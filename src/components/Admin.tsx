import { useEffect, useMemo, useState } from 'react'
import {
  addPeriod,
  createEmployee,
  createSystemCategory,
  deleteEmployee,
  deletePeriod,
  fetchAdmin,
  updateEmployee,
  updateSystemCategory,
  type AdminData,
  type Employee,
  type Project,
} from '../lib/admin'

const COLORS = ['#7c6dfa', '#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#0ea5e9']

export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  function load() {
    return fetchAdmin()
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
  }, [])

  return (
    <div className="analytics">
      <div className="ana-head">
        <h2 className="admin-h">Verwaltung</h2>
      </div>
      {error && <div className="status err">✕ {error}</div>}
      {loading && <div className="status pending">… lädt</div>}
      {data && (
        <>
          <EmployeesSection data={data} reload={load} setError={setError} />
          <CategoriesSection data={data} reload={load} />
        </>
      )}
    </div>
  )
}

// ── Mitarbeiter ─────────────────────────────────────────────────────────────

function EmployeesSection({ data, reload, setError }: { data: AdminData; reload: () => Promise<void>; setError: (s: string | null) => void }) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [periodsId, setPeriodsId] = useState<string | null>(null)

  const periodsByEmp = useMemo(() => {
    const m = new Map<string, AdminData['periods']>()
    for (const p of data.periods) {
      const arr = m.get(p.employee_id) ?? []
      arr.push(p)
      m.set(p.employee_id, arr)
    }
    return m
  }, [data.periods])

  async function onDelete(e: Employee) {
    if (!confirm(`Mitarbeiter „${e.name}" löschen? Zugehörige Buchungen werden mit entfernt.`)) return
    try {
      await deleteEmployee(e.id)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="ana-section">
      <div className="ana-toolbar">
        <h3 className="admin-sec">Mitarbeiter ({data.employees.length})</h3>
        <button className="btn-primary" onClick={() => { setAdding((v) => !v); setEditingId(null) }}>
          {adding ? '× Abbrechen' : '+ Mitarbeiter'}
        </button>
      </div>

      {adding && (
        <EmployeeForm
          onCancel={() => setAdding(false)}
          onSave={async (vals) => {
            await createEmployee(vals)
            setAdding(false)
            await reload()
          }}
        />
      )}

      <div className="table-scroll">
        <table className="ana-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th className="num">Wochenstunden</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => {
              const periods = periodsByEmp.get(e.id) ?? []
              return (
                <EmpRow
                  key={e.id}
                  e={e}
                  periods={periods}
                  isEditing={editingId === e.id}
                  isPeriods={periodsId === e.id}
                  onEdit={() => { setEditingId(editingId === e.id ? null : e.id); setPeriodsId(null) }}
                  onTogglePeriods={() => { setPeriodsId(periodsId === e.id ? null : e.id); setEditingId(null) }}
                  onDelete={() => onDelete(e)}
                  onSaveEdit={async (patch) => { await updateEmployee(e.id, patch); setEditingId(null); await reload() }}
                  onAddPeriod={async (from, hours) => { await addPeriod(e.id, from, hours); await reload() }}
                  onDeletePeriod={async (id) => { await deletePeriod(id); await reload() }}
                  setError={setError}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EmpRow({
  e, periods, isEditing, isPeriods, onEdit, onTogglePeriods, onDelete, onSaveEdit, onAddPeriod, onDeletePeriod, setError,
}: {
  e: Employee
  periods: AdminData['periods']
  isEditing: boolean
  isPeriods: boolean
  onEdit: () => void
  onTogglePeriods: () => void
  onDelete: () => void
  onSaveEdit: (patch: { name: string; email: string | null; weekly_hours: number; active: boolean }) => Promise<void>
  onAddPeriod: (from: string, hours: number) => Promise<void>
  onDeletePeriod: (id: string) => Promise<void>
  setError: (s: string | null) => void
}) {
  const [pFrom, setPFrom] = useState('')
  const [pHours, setPHours] = useState('')

  if (isEditing) {
    return (
      <tr>
        <td colSpan={5}>
          <EmployeeForm initial={e} onCancel={onEdit} onSave={onSaveEdit} />
        </td>
      </tr>
    )
  }
  return (
    <>
      <tr className={e.active ? '' : 'dim'}>
        <td>{e.name}</td>
        <td className="dim">{e.email ?? '—'}</td>
        <td className="num">
          {e.weekly_hours} h{periods.length > 0 && <span title={`${periods.length} abweichende Periode(n)`}> 🕒</span>}
        </td>
        <td>{e.active ? <span className="badge green">aktiv</span> : <span className="badge dim">inaktiv</span>}</td>
        <td className="ms-row-actions">
          <button className="icon-btn" title="Bearbeiten" onClick={onEdit}>✎</button>
          <button className="icon-btn" title="Arbeitszeiten" onClick={onTogglePeriods}>🕒</button>
          <button className="icon-btn" title="Löschen" onClick={onDelete}>🗑</button>
        </td>
      </tr>
      {isPeriods && (
        <tr>
          <td colSpan={5}>
            <div className="admin-periods">
              <div className="dim">Abweichende Wochenstunden ab Datum (überschreiben die Basis ab dort):</div>
              {periods.length === 0 && <div className="dim">Keine abweichenden Zeiträume.</div>}
              {periods.map((p) => (
                <div key={p.id} className="admin-period-row">
                  <span>ab {p.valid_from}</span>
                  <span>{p.weekly_hours} h/Woche</span>
                  <button className="icon-btn" title="Entfernen" onClick={() => onDeletePeriod(p.id).catch((err) => setError((err as Error).message))}>🗑</button>
                </div>
              ))}
              <div className="admin-period-add">
                <input type="date" value={pFrom} onChange={(ev) => setPFrom(ev.target.value)} />
                <input inputMode="decimal" placeholder="h/Woche" value={pHours} onChange={(ev) => setPHours(ev.target.value)} />
                <button
                  className="btn-ghost"
                  disabled={!pFrom || !pHours}
                  onClick={async () => {
                    try {
                      await onAddPeriod(pFrom, Number(pHours.replace(',', '.')))
                      setPFrom(''); setPHours('')
                    } catch (err) { setError((err as Error).message) }
                  }}
                >
                  + Periode
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function EmployeeForm({
  initial, onSave, onCancel,
}: {
  initial?: Employee
  onSave: (vals: { name: string; email: string | null; weekly_hours: number; active: boolean }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [hours, setHours] = useState(initial?.weekly_hours != null ? String(initial.weekly_hours) : '40')
  const [active, setActive] = useState(initial?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!name.trim()) { setErr('Name ist Pflicht.'); return }
    setSaving(true); setErr(null)
    try {
      await onSave({ name: name.trim(), email: email.trim() || null, weekly_hours: Number(hours.replace(',', '.')) || 0, active })
    } catch (e) {
      setErr((e as Error).message); setSaving(false)
    }
  }

  return (
    <form className="ms-form" onSubmit={submit}>
      <div className="ms-form-grid proj-form-grid">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>E-Mail<input type="email" value={email} placeholder="vorname.nachname@trendone.com" onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Wochenstunden<input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label className="admin-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> aktiv
        </label>
      </div>
      {err && <div className="status err">✕ {err}</div>}
      <div className="ms-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichert…' : 'Speichern'}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  )
}

// ── System-Kategorien ────────────────────────────────────────────────────────

function CategoriesSection({ data, reload }: { data: AdminData; reload: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  return (
    <section className="ana-section">
      <div className="ana-toolbar">
        <h3 className="admin-sec">System-Kategorien ({data.systemProjects.length})</h3>
        <button className="btn-primary" onClick={() => { setAdding((v) => !v); setEditId(null) }}>
          {adding ? '× Abbrechen' : '+ Kategorie'}
        </button>
      </div>
      <p className="hint">Nicht-buchbare Zeit (Urlaub, Krank, Admin, Frei …). Mindern die Kapazität, sind kein Projekt-Budget.</p>

      {adding && (
        <CategoryForm
          onCancel={() => setAdding(false)}
          onSave={async (name, color) => { await createSystemCategory(name, color); setAdding(false); await reload() }}
        />
      )}

      <div className="admin-cat-list">
        {data.systemProjects.map((c) =>
          editId === c.id ? (
            <CategoryForm
              key={c.id}
              initial={c}
              onCancel={() => setEditId(null)}
              onSave={async (name, color) => { await updateSystemCategory(c.id, { name, color }); setEditId(null); await reload() }}
            />
          ) : (
            <div key={c.id} className="admin-cat-row">
              <span className="dot" style={{ background: c.color ?? '#94a3b8' }} />
              <span className="admin-cat-name">{c.name}</span>
              <button className="icon-btn" title="Bearbeiten" onClick={() => { setEditId(c.id); setAdding(false) }}>✎</button>
            </div>
          ),
        )}
      </div>
    </section>
  )
}

function CategoryForm({
  initial, onSave, onCancel,
}: {
  initial?: Project
  onSave: (name: string, color: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? COLORS[1])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!name.trim()) { setErr('Name ist Pflicht.'); return }
    setSaving(true); setErr(null)
    try { await onSave(name.trim(), color) } catch (e) { setErr((e as Error).message); setSaving(false) }
  }

  return (
    <form className="ms-form" onSubmit={submit}>
      <div className="ms-form-grid">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>
          Farbe
          <div className="admin-swatches">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`admin-swatch${c === color ? ' sel' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </label>
      </div>
      {err && <div className="status err">✕ {err}</div>}
      <div className="ms-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichert…' : 'Speichern'}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  )
}
