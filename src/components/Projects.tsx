import { useEffect, useMemo, useState } from 'react'
import {
  fetchProjectDetail,
  fetchProjects,
  PROJECT_STATES,
  updateProject,
  type Project,
  type ProjectDetail,
} from '../lib/projects'
import { workingDaysBetween } from '../lib/dates'
import {
  createMilestone,
  deleteMilestone,
  updateMilestone,
  INVOICE_STATES,
  type ProjectLite,
} from '../lib/milestones'
import MilestoneForm from './MilestoneForm'

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const dateFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
function fmtDate(iso: string | null): string {
  return iso ? dateFmt.format(new Date(`${iso}T00:00:00`)) : '—'
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    fetchProjects()
      .then(setProjects)
      .catch((e) => setError(e.message ?? String(e)))
  }
  useEffect(load, [])

  if (selected) {
    return (
      <ProjectDetailView
        projectId={selected}
        onBack={() => {
          setSelected(null)
          load()
        }}
      />
    )
  }

  return (
    <div className="dash">
      {error && <div className="status err">✕ {error}</div>}
      {!projects && <div className="status pending">… lädt</div>}
      {projects && projects.length === 0 && <p className="hint">Noch keine Projekte angelegt.</p>}
      <div className="proj-grid">
        {projects?.map((p) => (
          <button key={p.id} className="proj-card" onClick={() => setSelected(p.id)}>
            <span className="proj-card-bar" style={{ background: p.color ?? '#94a3b8' }} />
            <div className="proj-card-body">
              <div className="proj-card-name">{p.name}</div>
              <div className="proj-card-client">{p.client ?? 'Kein Kunde'}</div>
              <div className="proj-card-meta">
                <span className={`status-pill st-${p.status}`}>{p.status}</span>
                {p.budget_eur != null && <span>{eur.format(Number(p.budget_eur))}</span>}
                {p.budget_days != null && <span>{Number(p.budget_days)} Tage</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ProjectDetailView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [msAdding, setMsAdding] = useState(false)
  const [msEditing, setMsEditing] = useState<string | null>(null)

  function load() {
    fetchProjectDetail(projectId)
      .then(setDetail)
      .catch((e) => setError(e.message ?? String(e)))
  }
  useEffect(load, [projectId])

  const empName = useMemo(() => {
    const m = new Map<string, string>()
    detail?.employees.forEach((e) => m.set(e.id, e.name))
    return m
  }, [detail])

  // Verplante Tage je Mitarbeiter (Buchung über Mo–Fr ausgerollt × budget).
  const perEmp = useMemo(() => {
    const m = new Map<string, number>()
    detail?.bookings.forEach((b) => {
      const days = workingDaysBetween(b.start_date, b.end_date) * Number(b.budget)
      m.set(b.employee_id, (m.get(b.employee_id) ?? 0) + days)
    })
    return [...m.entries()]
      .map(([id, days]) => ({ id, name: empName.get(id) ?? '—', days }))
      .sort((a, b) => b.days - a.days)
  }, [detail, empName])

  const totalPlanned = perEmp.reduce((s, e) => s + e.days, 0)

  const msSums = useMemo(() => {
    let offen = 0,
      gestellt = 0,
      bezahlt = 0
    detail?.milestones.forEach((m) => {
      const a = Number(m.amount_eur ?? 0)
      if (m.invoice_status === 'offen') offen += a
      else if (m.invoice_status === 'gestellt') gestellt += a
      else if (m.invoice_status === 'bezahlt') bezahlt += a
    })
    return { offen, gestellt, bezahlt }
  }, [detail])

  async function onMsStatus(id: string, status: string) {
    try {
      await updateMilestone(id, { invoice_status: status })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function onMsDelete(id: string, title: string) {
    if (!confirm(`Meilenstein „${title}" löschen?`)) return
    try {
      await deleteMilestone(id)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <div className="dash"><div className="status err">✕ {error}</div></div>
  if (!detail) return <div className="dash"><div className="status pending">… lädt</div></div>

  const p = detail.project
  const projLite: ProjectLite = {
    id: p.id,
    name: p.name,
    color: p.color,
    client: p.client,
    is_system: p.is_system,
  }
  const budgetDays = p.budget_days != null ? Number(p.budget_days) : null
  const pct = budgetDays ? Math.round((totalPlanned / budgetDays) * 100) : null
  const over = pct != null && pct > 100

  if (editing) {
    return (
      <div className="dash">
        <button className="btn-ghost back-btn" onClick={() => setEditing(false)}>
          ← Zurück
        </button>
        <ProjectForm
          project={p}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            await updateProject(p.id, patch)
            setEditing(false)
            load()
          }}
        />
      </div>
    )
  }

  return (
    <div className="dash">
      <div className="detail-top">
        <button className="btn-ghost back-btn" onClick={onBack}>
          ← Alle Projekte
        </button>
        <button className="btn-primary" onClick={() => setEditing(true)}>
          ✎ Projekt bearbeiten
        </button>
      </div>

      <div className="proj-head">
        <span className="proj-head-bar" style={{ background: p.color ?? '#94a3b8' }} />
        <div>
          <h2 className="proj-head-name">{p.name}</h2>
          <div className="proj-head-sub">
            <span className={`status-pill st-${p.status}`}>{p.status}</span>
            {p.client && <span>{p.client}</span>}
            {(p.start_date || p.end_date) && (
              <span>
                {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Ressourcen */}
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Budget</div>
          <div className="kpi-val">{budgetDays != null ? `${budgetDays} Tage` : '—'}</div>
        </div>
        <div className={`kpi${over ? ' kpi-alert' : ''}`}>
          <div className="kpi-label">Verplant</div>
          <div className="kpi-val">{totalPlanned} Tage</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Budget €</div>
          <div className="kpi-val">{p.budget_eur != null ? eur.format(Number(p.budget_eur)) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Auslastung</div>
          <div className="kpi-val">{pct != null ? `${pct}%` : '—'}</div>
        </div>
      </div>

      {budgetDays != null && (
        <div className="cap-bar big" title={`${totalPlanned} / ${budgetDays} Tage`}>
          <span
            style={{
              width: `${Math.min(pct ?? 0, 100)}%`,
              background: over ? 'var(--red)' : undefined,
            }}
          />
        </div>
      )}

      {/* Team / Mitarbeitende */}
      <section className="ms-group">
        <h3 className="ms-group-title">
          Mitarbeitende
          <span className="ms-count">{perEmp.length}</span>
        </h3>
        {perEmp.length === 0 ? (
          <p className="hint">Noch niemand auf dieses Projekt verplant.</p>
        ) : (
          <div className="ms-list">
            {perEmp.map((e) => (
              <div key={e.id} className="team-row">
                <span className="team-name">{e.name}</span>
                <span className="team-days">{e.days} Tage verplant</span>
                <div className="cap-bar">
                  <span
                    style={{ width: `${totalPlanned ? (e.days / totalPlanned) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Meilensteine */}
      <section className="ms-group">
        <h3 className="ms-group-title">
          Meilensteine
          <span className="ms-count">{detail.milestones.length}</span>
          <button
            className="btn-ghost ms-add-btn"
            onClick={() => {
              setMsEditing(null)
              setMsAdding((v) => !v)
            }}
          >
            {msAdding ? '× Abbrechen' : '+ Meilenstein'}
          </button>
        </h3>

        {msAdding && (
          <MilestoneForm
            projects={[projLite]}
            onCancel={() => setMsAdding(false)}
            onSave={async (vals) => {
              await createMilestone(vals)
              setMsAdding(false)
              load()
            }}
          />
        )}

        {detail.milestones.length === 0 && !msAdding ? (
          <p className="hint">Noch keine Meilensteine für dieses Projekt.</p>
        ) : (
          <>
            <div className="ms-list">
              {detail.milestones.map((m) =>
                msEditing === m.id ? (
                  <MilestoneForm
                    key={m.id}
                    projects={[projLite]}
                    initial={m}
                    onCancel={() => setMsEditing(null)}
                    onSave={async (vals) => {
                      await updateMilestone(m.id, vals)
                      setMsEditing(null)
                      load()
                    }}
                  />
                ) : (
                  <div key={m.id} className="ms-row ms-row-compact">
                    <div className="ms-main">
                      <div className="ms-title">{m.title}</div>
                    </div>
                    <div className="ms-due">{fmtDate(m.due_date)}</div>
                    <div className="ms-amount">
                      {m.amount_eur != null ? eur.format(Number(m.amount_eur)) : '—'}
                    </div>
                    <select
                      className={`ms-status st-${m.invoice_status}`}
                      value={m.invoice_status}
                      onChange={(e) => onMsStatus(m.id, e.target.value)}
                    >
                      {INVOICE_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <div className="ms-row-actions">
                      <button
                        className="icon-btn"
                        title="Bearbeiten"
                        onClick={() => {
                          setMsAdding(false)
                          setMsEditing(m.id)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn"
                        title="Löschen"
                        onClick={() => onMsDelete(m.id, m.title)}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
            {detail.milestones.length > 0 && (
              <div className="ms-sums">
                <span>Offen: {eur.format(msSums.offen)}</span>
                <span>Gestellt: {eur.format(msSums.gestellt)}</span>
                <span>Bezahlt: {eur.format(msSums.bezahlt)}</span>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

// ---------- Projekt-Bearbeitungsformular ----------

function ProjectForm({
  project,
  onSave,
  onCancel,
}: {
  project: Project
  onSave: (patch: {
    name: string
    client: string | null
    status: string
    color: string
    start_date: string | null
    end_date: string | null
    budget_days: number | null
    budget_eur: number | null
  }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(project.name)
  const [client, setClient] = useState(project.client ?? '')
  const [status, setStatus] = useState(project.status)
  const [color, setColor] = useState(project.color ?? '#7c6dfa')
  const [start, setStart] = useState(project.start_date ?? '')
  const [end, setEnd] = useState(project.end_date ?? '')
  const [budgetDays, setBudgetDays] = useState(
    project.budget_days != null ? String(project.budget_days) : '',
  )
  const [budgetEur, setBudgetEur] = useState(
    project.budget_eur != null ? String(project.budget_eur) : '',
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setErr('Name ist Pflicht.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onSave({
        name: name.trim(),
        client: client.trim() || null,
        status,
        color,
        start_date: start || null,
        end_date: end || null,
        budget_days: num(budgetDays),
        budget_eur: num(budgetEur),
      })
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <form className="ms-form" onSubmit={submit}>
      <div className="ms-form-grid proj-form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Kunde
          <input value={client} onChange={(e) => setClient(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {PROJECT_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Farbe
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label>
          Start
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Ende
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          Budget (Tage)
          <input
            inputMode="decimal"
            value={budgetDays}
            onChange={(e) => setBudgetDays(e.target.value)}
          />
        </label>
        <label>
          Budget (EUR)
          <input
            inputMode="decimal"
            value={budgetEur}
            onChange={(e) => setBudgetEur(e.target.value)}
          />
        </label>
      </div>
      {err && <div className="status err">✕ {err}</div>}
      <div className="ms-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}
