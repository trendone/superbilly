import { useEffect, useMemo, useState } from 'react'
import {
  createProject,
  deleteProject,
  fetchLinkableZohoProjects,
  fetchProjectDetail,
  fetchProjectsView,
  linkProject,
  PROJECT_STATES,
  unlinkProject,
  updateProject,
  type LinkableProject,
  type Project,
  type ProjectDetail,
  type ProjectsView,
} from '../lib/projects'
import { workingDaysBetween } from '../lib/dates'
import { KEYNOTE_KTR } from '../lib/analytics'
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

export default function Projects({ isAdmin = false }: { isAdmin?: boolean }) {
  const [view, setView] = useState<ProjectsView | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter
  const [empFilter, setEmpFilter] = useState('alle')
  const [statusFilter, setStatusFilter] = useState('alle')
  const [originFilter, setOriginFilter] = useState('alle') // alle | kunde | intern
  const [catFilter, setCatFilter] = useState('no-keynote') // Default: Keynotes ausgeblendet
  const [newFilter, setNewFilter] = useState('alle') // alle | neu

  function load() {
    fetchProjectsView()
      .then(setView)
      .catch((e) => setError(e.message ?? String(e)))
  }
  useEffect(load, [])

  // Distinkte Kategorien für das Dropdown.
  const categories = useMemo(() => {
    const s = new Set<string>()
    view?.projects.forEach((p) => p.categoryLabel && s.add(p.categoryLabel))
    return [...s].sort((a, b) => a.localeCompare(b, 'de'))
  }, [view])

  const filtered = useMemo(() => {
    if (!view) return []
    return view.projects.filter((p) => {
      if (empFilter !== 'alle' && !p.employeeIds.includes(empFilter)) return false
      if (statusFilter !== 'alle' && p.status !== statusFilter) return false
      if (originFilter === 'kunde' && p.source !== 'zoho') return false
      if (originFilter === 'intern' && p.source === 'zoho') return false
      if (newFilter === 'neu' && !p.is_new) return false
      if (catFilter === 'no-keynote') {
        if (p.categoryKtr && (KEYNOTE_KTR as readonly string[]).includes(p.categoryKtr)) return false
      } else if (catFilter === 'intern') {
        if (p.source === 'zoho') return false
      } else if (catFilter !== 'alle' && p.categoryLabel !== catFilter) return false
      return true
    })
  }, [view, empFilter, statusFilter, originFilter, catFilter, newFilter])

  if (selected) {
    return (
      <ProjectDetailView
        projectId={selected}
        isAdmin={isAdmin}
        onBack={() => {
          setSelected(null)
          load()
        }}
      />
    )
  }

  if (creating) {
    return (
      <div className="dash">
        <button className="btn-ghost back-btn" onClick={() => setCreating(false)}>
          ← Alle Projekte
        </button>
        <h2 className="proj-head-name">Internes Projekt anlegen</h2>
        <p className="hint">
          ℹ️ Kundenprojekte werden automatisch über Zoho angelegt und sollten <b>nicht</b> von
          Hand erfasst werden. Nutze diese Funktion nur für interne Projekte (z. B. eigene
          Vorhaben, Templates), die es in Zoho nicht gibt.
        </p>
        <ProjectForm
          onCancel={() => setCreating(false)}
          onSave={async (patch) => {
            const p = await createProject(patch)
            setCreating(false)
            load()
            setSelected(p.id)
          }}
        />
      </div>
    )
  }

  return (
    <div className="dash">
      {error && <div className="status err">✕ {error}</div>}
      {!view && <div className="status pending">… lädt</div>}

      {view && (
        <div className="ana-toolbar">
          <label>
            Mitarbeiter{' '}
            <select
              className="field-inline"
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
            >
              <option value="alle">Alle</option>
              {view.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status{' '}
            <select
              className="field-inline"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="alle">Alle</option>
              <option value="aktiv">aktiv</option>
              <option value="angebot">Angebot verschickt</option>
              <option value="verhandlung">Verhandlungsphase</option>
              <option value="abgeschlossen">abgeschlossen</option>
            </select>
          </label>
          <label>
            Herkunft{' '}
            <select
              className="field-inline"
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value)}
            >
              <option value="alle">Alle</option>
              <option value="kunde">Kundenprojekt (Zoho)</option>
              <option value="intern">Intern</option>
            </select>
          </label>
          <label>
            Kategorie{' '}
            <select
              className="field-inline"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
            >
              <option value="no-keynote">Ohne Keynotes</option>
              <option value="alle">Alle</option>
              <option value="intern">Intern</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Neu{' '}
            <select
              className="field-inline"
              value={newFilter}
              onChange={(e) => setNewFilter(e.target.value)}
            >
              <option value="alle">Alle</option>
              <option value="neu">Nur neue</option>
            </select>
          </label>
          <span className="dim">{filtered.length} Projekte</span>
        </div>
      )}

      {view && view.projects.length === 0 && <p className="hint">Noch keine Projekte angelegt.</p>}
      {view && view.projects.length > 0 && filtered.length === 0 && (
        <p className="hint">Keine Projekte für diesen Filter.</p>
      )}
      <div className="proj-grid">
        {filtered.map((p) => (
          <button key={p.id} className="proj-card" onClick={() => setSelected(p.id)}>
            <span className="proj-card-bar" style={{ background: p.color ?? '#94a3b8' }} />
            <div className="proj-card-body">
              <div className="proj-card-name">{p.name}</div>
              <div className="proj-card-client">{p.client ?? 'Kein Kunde'}</div>
              <div className="proj-card-meta">
                <span className={`status-pill st-${p.status}`}>{p.status}</span>
                {p.is_new && <span className="proj-tag proj-tag-new">Neu</span>}
                {p.source === 'zoho' ? (
                  <span className="proj-tag">Zoho</span>
                ) : (
                  <span className="proj-tag proj-tag-intern">Intern</span>
                )}
                {p.linkedProject && (
                  <span className="proj-tag" title={`Zusammengeführt mit Zoho-Projekt „${p.linkedProject.name}"`}>
                    🔗 Zoho
                  </span>
                )}
                {p.categoryLabel && <span className="proj-tag">{p.categoryLabel}</span>}
                {p.budget_eur != null && <span>{eur.format(Number(p.budget_eur))}</span>}
                {p.budget_days != null && <span>{Number(p.budget_days)} Tage</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {isAdmin && (
        <div className="proj-add-fallback">
          <button className="btn-ghost" onClick={() => setCreating(true)}>
            + Internes Projekt anlegen
          </button>
          <span className="dim">Kundenprojekte laufen über Zoho</span>
        </div>
      )}
    </div>
  )
}

export function ProjectDetailView({
  projectId,
  onBack,
  isAdmin = false,
}: {
  projectId: string
  onBack: () => void
  isAdmin?: boolean
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [msAdding, setMsAdding] = useState(false)
  const [msEditing, setMsEditing] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

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

  async function onLink(zohoProjectId: string) {
    try {
      await linkProject(projectId, zohoProjectId)
      setLinking(false)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function onUnlink() {
    if (!confirm('Zoho-Verknüpfung wirklich aufheben? Budget und Meilensteine des Zoho-Deals werden dann nicht mehr an diesem Projekt angezeigt.'))
      return
    try {
      await unlinkProject(projectId)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function onProjectDelete() {
    if (!detail) return
    if (
      !confirm(
        `Projekt „${detail.project.name}" wirklich löschen? Alle Buchungen und Meilensteine dieses Projekts werden ebenfalls gelöscht.`,
      )
    )
      return
    try {
      await deleteProject(detail.project.id)
      onBack()
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
  const linked = detail.linkedProject
  const budgetDays = p.budget_days != null ? Number(p.budget_days) : null
  // Budget des verknüpften Zoho-Deals einblenden, falls intern keines gepflegt ist.
  const budgetEur = p.budget_eur ?? linked?.budget_eur ?? null
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
        <div className="detail-top-actions">
          <button className="btn-primary" onClick={() => setEditing(true)}>
            ✎ Projekt bearbeiten
          </button>
          {p.source !== 'zoho' && (
            <button className="icon-btn-danger" title="Projekt löschen" onClick={onProjectDelete}>
              🗑
            </button>
          )}
        </div>
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

      {/* Zoho-Verknüpfung (Zusammenführung interner ↔ Zoho-Projekte) */}
      {p.source !== 'zoho' && (
        <section className="zoho-link">
          {linked ? (
            <div className="zoho-link-banner">
              <span>
                🔗 Zusammengeführt mit Zoho-Projekt <b>{linked.name}</b>
                {linked.offer_number ? ` (A - ${linked.offer_number})` : ''} – Budget und
                Meilensteine des Zoho-Deals sind hier eingeblendet.
              </span>
              {isAdmin && (
                <button className="btn-ghost" onClick={onUnlink}>
                  Verknüpfung lösen
                </button>
              )}
            </div>
          ) : isAdmin ? (
            linking ? (
              <ZohoLinkPicker
                excludeId={projectId}
                onPick={onLink}
                onCancel={() => setLinking(false)}
              />
            ) : (
              <button className="btn-ghost" onClick={() => setLinking(true)}>
                🔗 Mit Zoho-Projekt verknüpfen
              </button>
            )
          ) : null}
        </section>
      )}

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
          <div className="kpi-val">{budgetEur != null ? eur.format(Number(budgetEur)) : '—'}</div>
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
                m.source !== 'zoho' && msEditing === m.id ? (
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
                    {m.source === 'zoho' ? (
                      <>
                        <span className={`ms-status st-${m.invoice_status}`} title="Aus Zoho gespiegelt – read-only">
                          {m.invoice_status}
                        </span>
                        <div className="ms-row-actions">
                          <span className="dim" title="Aus Zoho gespiegelt – in Zoho (Abgrenzungen) pflegen">🔒 Zoho</span>
                        </div>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
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

// ---------- Zoho-Verknüpfung: Auswahl des Zielprojekts ----------

function ZohoLinkPicker({
  excludeId,
  onPick,
  onCancel,
}: {
  excludeId: string
  onPick: (zohoProjectId: string) => void
  onCancel: () => void
}) {
  const [options, setOptions] = useState<LinkableProject[] | null>(null)
  const [query, setQuery] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetchLinkableZohoProjects(excludeId)
      .then(setOptions)
      .catch((e) => setErr((e as Error).message))
  }, [excludeId])

  const filtered = useMemo(() => {
    if (!options) return []
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.client ?? '').toLowerCase().includes(q) ||
        (o.offer_number ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  return (
    <div className="zoho-link-picker">
      <div className="zoho-link-picker-head">
        <input
          autoFocus
          placeholder="Zoho-Projekt suchen (Name, Kunde, Angebotsnr.)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
      {err && <div className="status err">✕ {err}</div>}
      {!options && !err && <p className="hint">… lädt</p>}
      {options && filtered.length === 0 && (
        <p className="hint">Keine passenden (freien) Zoho-Projekte gefunden.</p>
      )}
      <div className="zoho-link-list">
        {filtered.map((o) => (
          <button key={o.id} className="zoho-link-option" onClick={() => onPick(o.id)}>
            <span className="zoho-link-option-name">{o.name}</span>
            <span className="zoho-link-option-meta">
              {o.client ?? 'Kein Kunde'}
              {o.offer_number ? ` · A - ${o.offer_number}` : ''}
              {o.budget_eur != null ? ` · ${eur.format(Number(o.budget_eur))}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Projekt-Bearbeitungsformular ----------

export function ProjectForm({
  project,
  onSave,
  onCancel,
}: {
  project?: Project
  onSave: (patch: {
    name: string
    client: string | null
    status: string
    color: string
    start_date: string | null
    end_date: string | null
    budget_days: number | null
    budget_eur: number | null
    day_rate_eur: number | null
  }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [client, setClient] = useState(project?.client ?? '')
  const [status, setStatus] = useState(project?.status ?? 'aktiv')
  const [color, setColor] = useState(project?.color ?? '#7c6dfa')
  const [start, setStart] = useState(project?.start_date ?? '')
  const [end, setEnd] = useState(project?.end_date ?? '')
  const [budgetDays, setBudgetDays] = useState(
    project?.budget_days != null ? String(project.budget_days) : '',
  )
  const [budgetEur, setBudgetEur] = useState(
    project?.budget_eur != null ? String(project.budget_eur) : '',
  )
  const [dayRate, setDayRate] = useState(
    project?.day_rate_eur != null ? String(project.day_rate_eur) : '',
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
        day_rate_eur: num(dayRate),
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
        <label>
          Tagessatz (EUR)
          <input
            inputMode="decimal"
            value={dayRate}
            placeholder="leer = aus Mite / Standard 2000"
            onChange={(e) => setDayRate(e.target.value)}
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
