import { useEffect, useMemo, useState } from 'react'
import {
  assignMiteOverride,
  fetchMapping,
  ignoreUnmatched,
  removeOverride,
  triggerMiteSync,
  type MappingData,
  type ProjectOption,
  type UnmatchedRow,
} from '../lib/mapping'
import {
  addPeriod,
  createDepartment,
  createEmployee,
  createSystemCategory,
  deleteDepartment,
  deleteEmployee,
  deletePeriod,
  fetchAdmin,
  grantAdmin,
  revokeAdmin,
  updateDepartment,
  updateEmployee,
  updateSystemCategory,
  type AdminData,
  type Department,
  type Employee,
  type Project,
} from '../lib/admin'

const COLORS = ['#7c6dfa', '#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#0ea5e9']

export default function Admin({ currentEmail }: { currentEmail: string }) {
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
          <EmployeesSection data={data} reload={load} setError={setError} currentEmail={currentEmail} />
          <MappingSection />
          <DepartmentsSection data={data} reload={load} setError={setError} />
          <CategoriesSection data={data} reload={load} />
        </>
      )}
    </div>
  )
}

// ── Mitarbeiter ─────────────────────────────────────────────────────────────

function EmployeesSection({
  data, reload, setError, currentEmail,
}: {
  data: AdminData
  reload: () => Promise<void>
  setError: (s: string | null) => void
  currentEmail: string
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [periodsId, setPeriodsId] = useState<string | null>(null)
  const [roleBusy, setRoleBusy] = useState<string | null>(null)

  const periodsByEmp = useMemo(() => {
    const m = new Map<string, AdminData['periods']>()
    for (const p of data.periods) {
      const arr = m.get(p.employee_id) ?? []
      arr.push(p)
      m.set(p.employee_id, arr)
    }
    return m
  }, [data.periods])

  // Rollen sind per E-Mail geführt. Nur Admins sehen/nutzen die Verwaltung.
  const adminEmails = useMemo(
    () => new Set(data.roles.filter((r) => r.role === 'admin').map((r) => r.email.toLowerCase())),
    [data.roles],
  )
  // Admin-Einträge ohne passenden Mitarbeiter — damit sie entziehbar bleiben.
  const orphanAdmins = useMemo(() => {
    const empEmails = new Set(data.employees.filter((e) => e.email).map((e) => e.email!.toLowerCase()))
    return [...adminEmails].filter((email) => !empEmails.has(email)).sort()
  }, [adminEmails, data.employees])

  async function onDelete(e: Employee) {
    if (!confirm(`Mitarbeiter „${e.name}" löschen? Zugehörige Buchungen werden mit entfernt.`)) return
    try {
      await deleteEmployee(e.id)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function toggleAdmin(email: string, makeAdmin: boolean) {
    setRoleBusy(email); setError(null)
    try {
      if (makeAdmin) await grantAdmin(email)
      else await revokeAdmin(email)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRoleBusy(null)
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
      <p className="hint">Nur Admins sehen und nutzen den Bereich „Verwaltung". Alle übrigen angemeldeten Nutzer sind „User" (Planung). Ohne E-Mail kann keine Rolle vergeben werden.</p>

      {adding && (
        <EmployeeForm
          departments={data.departments}
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
              <th>Abteilung</th>
              <th className="num">Wochenstunden</th>
              <th>Status</th>
              <th>Rolle</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => {
              const periods = periodsByEmp.get(e.id) ?? []
              const email = e.email?.toLowerCase() ?? null
              return (
                <EmpRow
                  key={e.id}
                  e={e}
                  departments={data.departments}
                  periods={periods}
                  isEditing={editingId === e.id}
                  isPeriods={periodsId === e.id}
                  isAdmin={email ? adminEmails.has(email) : false}
                  isSelf={email != null && email === currentEmail.toLowerCase()}
                  roleBusy={email != null && roleBusy === email}
                  onToggleAdmin={email ? (makeAdmin) => toggleAdmin(email, makeAdmin) : null}
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
            {orphanAdmins.map((email) => (
              <tr key={email} className="dim">
                <td>— (kein Mitarbeiter)</td>
                <td className="dim">{email}</td>
                <td><span className="dim">—</span></td>
                <td className="num">—</td>
                <td>—</td>
                <td><span className="badge" style={{ background: '#7c6dfa22', color: '#7c6dfa' }}>Admin</span></td>
                <td className="ms-row-actions">
                  <button
                    className="btn-ghost"
                    disabled={roleBusy === email || email === currentEmail.toLowerCase()}
                    title={email === currentEmail.toLowerCase() ? 'Die eigene Admin-Rolle kann nicht entzogen werden' : 'Admin-Rolle entziehen'}
                    onClick={() => toggleAdmin(email, false)}
                  >
                    Admin entziehen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EmpRow({
  e, departments, periods, isEditing, isPeriods, isAdmin, isSelf, roleBusy, onToggleAdmin, onEdit, onTogglePeriods, onDelete, onSaveEdit, onAddPeriod, onDeletePeriod, setError,
}: {
  e: Employee
  departments: Department[]
  periods: AdminData['periods']
  isEditing: boolean
  isPeriods: boolean
  isAdmin: boolean
  isSelf: boolean
  roleBusy: boolean
  onToggleAdmin: ((makeAdmin: boolean) => void) | null
  onEdit: () => void
  onTogglePeriods: () => void
  onDelete: () => void
  onSaveEdit: (patch: { name: string; email: string | null; weekly_hours: number; active: boolean; bookable: boolean; department_id: string | null }) => Promise<void>
  onAddPeriod: (from: string, hours: number) => Promise<void>
  onDeletePeriod: (id: string) => Promise<void>
  setError: (s: string | null) => void
}) {
  const [pFrom, setPFrom] = useState('')
  const [pHours, setPHours] = useState('')
  const dept = departments.find((d) => d.id === e.department_id)

  if (isEditing) {
    return (
      <tr>
        <td colSpan={7}>
          <EmployeeForm initial={e} departments={departments} onCancel={onEdit} onSave={onSaveEdit} />
        </td>
      </tr>
    )
  }
  return (
    <>
      <tr className={e.active ? '' : 'dim'}>
        <td>{e.name}</td>
        <td className="dim">{e.email ?? '—'}</td>
        <td>
          {dept ? (
            <span className="badge" style={{ background: `${dept.color ?? '#94a3b8'}22`, color: dept.color ?? undefined }}>
              {dept.name}
            </span>
          ) : (
            <span className="dim">—</span>
          )}
        </td>
        <td className="num">
          {e.weekly_hours} h{periods.length > 0 && <span title={`${periods.length} abweichende Periode(n)`}> 🕒</span>}
        </td>
        <td>
          {e.active ? <span className="badge green">aktiv</span> : <span className="badge dim">inaktiv</span>}
          {!e.bookable && <span className="badge dim" title="Nicht im Planungsraster/Auswertung"> nicht buchbar</span>}
        </td>
        <td className="admin-role-cell">
          {isAdmin
            ? <span className="badge" style={{ background: '#7c6dfa22', color: '#7c6dfa' }}>Admin</span>
            : <span className="badge dim">User</span>}
          {onToggleAdmin && (
            <button
              className="btn-ghost admin-role-toggle"
              disabled={roleBusy || (isAdmin && isSelf)}
              title={isAdmin ? (isSelf ? 'Die eigene Admin-Rolle kann nicht entzogen werden' : 'Admin-Rolle entziehen') : 'Zum Admin machen'}
              onClick={() => onToggleAdmin(!isAdmin)}
            >
              {isAdmin ? 'Admin entziehen' : 'Zum Admin machen'}
            </button>
          )}
        </td>
        <td className="ms-row-actions">
          <button className="icon-btn" title="Bearbeiten" onClick={onEdit}>✎</button>
          <button className="icon-btn" title="Arbeitszeiten" onClick={onTogglePeriods}>🕒</button>
          <button className="icon-btn" title="Löschen" onClick={onDelete}>🗑</button>
        </td>
      </tr>
      {isPeriods && (
        <tr>
          <td colSpan={7}>
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
  initial, departments, onSave, onCancel,
}: {
  initial?: Employee
  departments: Department[]
  onSave: (vals: { name: string; email: string | null; weekly_hours: number; active: boolean; bookable: boolean; department_id: string | null }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [hours, setHours] = useState(initial?.weekly_hours != null ? String(initial.weekly_hours) : '40')
  const [active, setActive] = useState(initial?.active ?? true)
  const [bookable, setBookable] = useState(initial?.bookable ?? true)
  const [deptId, setDeptId] = useState(initial?.department_id ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!name.trim()) { setErr('Name ist Pflicht.'); return }
    setSaving(true); setErr(null)
    try {
      await onSave({ name: name.trim(), email: email.trim() || null, weekly_hours: Number(hours.replace(',', '.')) || 0, active, bookable, department_id: deptId || null })
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
        <label>Abteilung
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">— keine —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="admin-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> aktiv
        </label>
        <label className="admin-check" title="Erscheint nicht im Planungsraster und in der Auswertung (z. B. Geschäftsführung, Assistenz)">
          <input type="checkbox" checked={!bookable} onChange={(e) => setBookable(!e.target.checked)} /> nicht buchbar
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

// ── Zuordnungen (Mite/Zoho unmatched) ────────────────────────────────────────

function minutesToHours(min: number | null): string {
  if (!min) return '–'
  return `${Math.round((min / 60) * 10) / 10} h`
}

function MappingSection() {
  const [data, setData] = useState<MappingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  function load() {
    return fetchMapping()
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
  }, [])

  async function onSync() {
    setSyncing(true); setError(null); setInfo(null)
    try {
      const r = await triggerMiteSync()
      setInfo(`Mite abgerufen: ${r.actuals_upserted ?? 0} Ist-Zeilen aktualisiert.`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  const miteOverrides = useMemo(
    () => (data?.overrides ?? []).filter((o) => o.source === 'mite'),
    [data?.overrides],
  )

  return (
    <section className="ana-section">
      <div className="ana-toolbar">
        <h3 className="admin-sec">Zuordnungen</h3>
        <button className="btn-primary" onClick={onSync} disabled={syncing}>
          {syncing ? '… Mite läuft' : '⟳ Mite neu abrufen'}
        </button>
      </div>
      <p className="hint">
        Mite-Projekte ohne Projekt-Treffer lassen sich hier manuell einem Projekt zuordnen
        (greift beim nächsten Abruf).
      </p>
      {error && <div className="status err">✕ {error}</div>}
      {info && <div className="status ok">✓ {info}</div>}
      {loading && <div className="status pending">… lädt</div>}

      {data && (
        <>
          {/* ── Mite: zuordenbar ── */}
          <h4 className="admin-sub">Mite ohne Zuordnung ({data.miteUnmatched.length})</h4>
          {data.miteUnmatched.length === 0 ? (
            <p className="dim">Alle Mite-Projekte sind zugeordnet.</p>
          ) : (
            <div className="table-scroll">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th>Mite-Projekt</th>
                    <th className="num">Ist</th>
                    <th>Projekt zuordnen</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.miteUnmatched.map((u) => (
                    <MiteUnmatchedRow
                      key={u.external_id}
                      row={u}
                      projects={data.projects}
                      onAssign={async (projectId) => { await assignMiteOverride(u.external_id, projectId); await load() }}
                      onIgnore={async () => { await ignoreUnmatched('mite', u.external_id); await load() }}
                      setError={setError}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Mite: bestehende Ausnahmen ── */}
          {miteOverrides.length > 0 && (
            <>
              <h4 className="admin-sub">Bestätigte Mite-Zuordnungen ({miteOverrides.length})</h4>
              <div className="admin-cat-list">
                {miteOverrides.map((o) => (
                  <div key={o.external_id} className="admin-cat-row">
                    <span className="dim">Mite #{o.external_id}</span>
                    <span className="admin-cat-name">→ {o.project_name}</span>
                    <button
                      className="icon-btn"
                      title="Zuordnung entfernen"
                      onClick={async () => {
                        try { await removeOverride('mite', o.external_id); await load() }
                        catch (e) { setError((e as Error).message) }
                      }}
                    >🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}

        </>
      )}
    </section>
  )
}

function MiteUnmatchedRow({
  row, projects, onAssign, onIgnore, setError,
}: {
  row: UnmatchedRow
  projects: ProjectOption[]
  onAssign: (projectId: string) => Promise<void>
  onIgnore: () => Promise<void>
  setError: (s: string | null) => void
}) {
  const [sel, setSel] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  return (
    <tr>
      <td>{row.label || `Mite #${row.external_id}`}</td>
      <td className="num">{minutesToHours(row.minutes)}</td>
      <td>
        <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={busy}>
          <option value="">— Projekt wählen —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.offer_number ? ` · A - ${p.offer_number}` : ''}
            </option>
          ))}
        </select>
      </td>
      <td className="ms-row-actions">
        <button className="btn-primary" disabled={!sel || busy} onClick={() => run(() => onAssign(sel))}>Zuordnen</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run(onIgnore)}>Ignorieren</button>
      </td>
    </tr>
  )
}

// ── Abteilungen ──────────────────────────────────────────────────────────────

function DepartmentsSection({ data, reload, setError }: { data: AdminData; reload: () => Promise<void>; setError: (s: string | null) => void }) {
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const countByDept = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.employees) {
      if (e.department_id) m.set(e.department_id, (m.get(e.department_id) ?? 0) + 1)
    }
    return m
  }, [data.employees])

  async function onDelete(d: Department) {
    const n = countByDept.get(d.id) ?? 0
    const extra = n > 0 ? ` ${n} Mitarbeiter verlieren die Zuordnung (werden „ohne Abteilung").` : ''
    if (!confirm(`Abteilung „${d.name}" löschen?${extra}`)) return
    try {
      await deleteDepartment(d.id)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="ana-section">
      <div className="ana-toolbar">
        <h3 className="admin-sec">Abteilungen ({data.departments.length})</h3>
        <button className="btn-primary" onClick={() => { setAdding((v) => !v); setEditId(null) }}>
          {adding ? '× Abbrechen' : '+ Abteilung'}
        </button>
      </div>
      <p className="hint">Eindeutiges Merkmal je Mitarbeiter. Dient der Gruppierung im Planungsraster und für Auswertungen.</p>

      {adding && (
        <DepartmentForm
          onCancel={() => setAdding(false)}
          onSave={async (name, color) => { await createDepartment(name, color); setAdding(false); await reload() }}
        />
      )}

      <div className="admin-cat-list">
        {data.departments.map((d) =>
          editId === d.id ? (
            <DepartmentForm
              key={d.id}
              initial={d}
              onCancel={() => setEditId(null)}
              onSave={async (name, color) => { await updateDepartment(d.id, { name, color }); setEditId(null); await reload() }}
            />
          ) : (
            <div key={d.id} className="admin-cat-row">
              <span className="dot" style={{ background: d.color ?? '#94a3b8' }} />
              <span className="admin-cat-name">{d.name}</span>
              <span className="dim">{countByDept.get(d.id) ?? 0} MA</span>
              <button className="icon-btn" title="Bearbeiten" onClick={() => { setEditId(d.id); setAdding(false) }}>✎</button>
              <button className="icon-btn" title="Löschen" onClick={() => onDelete(d)}>🗑</button>
            </div>
          ),
        )}
      </div>
    </section>
  )
}

function DepartmentForm({
  initial, onSave, onCancel,
}: {
  initial?: Department
  onSave: (name: string, color: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
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
