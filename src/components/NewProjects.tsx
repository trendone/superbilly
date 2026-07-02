import { useEffect, useMemo, useState } from 'react'
import { fetchProjectsView, type ProjectsView } from '../lib/projects'
import { KEYNOTE_KTR } from '../lib/analytics'
import { triggerZohoSync, type ZohoSyncResult } from '../lib/zoho'
import { ProjectDetailView } from './Projects'
import PipelineForecast from './PipelineForecast'

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export default function NewProjects() {
  const [sub, setSub] = useState<'plan' | 'pipeline'>('plan')
  const [view, setView] = useState<ProjectsView | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<ZohoSyncResult | null>(null)

  // Filter
  const [empFilter, setEmpFilter] = useState('alle')
  const [statusFilter, setStatusFilter] = useState('alle')
  const [originFilter, setOriginFilter] = useState('alle') // alle | kunde | intern
  const [catFilter, setCatFilter] = useState('no-keynote') // Default: Keynotes ausgeblendet

  function load() {
    fetchProjectsView()
      .then(setView)
      .catch((e) => setError(e.message ?? String(e)))
  }
  useEffect(load, [])

  async function onSync() {
    setSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      const res = await triggerZohoSync()
      setSyncResult(res)
      load()
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setSyncing(false)
    }
  }

  // Pipeline = neu markiert ODER noch keine Planungsbuchung ("muss noch verplant werden").
  const pipeline = useMemo(() => view?.projects.filter((p) => p.is_new || !p.hasBookings) ?? [], [view])

  const categories = useMemo(() => {
    const s = new Set<string>()
    pipeline.forEach((p) => p.categoryLabel && s.add(p.categoryLabel))
    return [...s].sort((a, b) => a.localeCompare(b, 'de'))
  }, [pipeline])

  const filtered = useMemo(() => {
    return pipeline.filter((p) => {
      if (empFilter !== 'alle' && !p.employeeIds.includes(empFilter)) return false
      if (statusFilter !== 'alle' && p.status !== statusFilter) return false
      if (originFilter === 'kunde' && p.source !== 'zoho') return false
      if (originFilter === 'intern' && p.source === 'zoho') return false
      if (catFilter === 'no-keynote') {
        if (p.categoryKtr && (KEYNOTE_KTR as readonly string[]).includes(p.categoryKtr)) return false
      } else if (catFilter === 'intern') {
        if (p.source === 'zoho') return false
      } else if (catFilter !== 'alle' && p.categoryLabel !== catFilter) return false
      return true
    })
  }, [pipeline, empFilter, statusFilter, originFilter, catFilter])

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
    <div>
      <div className="sub-tabs">
        <button className={`tab${sub === 'plan' ? ' active' : ''}`} onClick={() => setSub('plan')}>
          Zu verplanen
        </button>
        <button
          className={`tab${sub === 'pipeline' ? ' active' : ''}`}
          onClick={() => setSub('pipeline')}
        >
          🔮 Pipeline-Forecast
        </button>
      </div>

      {sub === 'pipeline' && <PipelineForecast />}

      {sub === 'plan' && (
    <div className="dash">
      <div className="ana-head">
        <div>
          <h2 className="admin-h">Neue Projekte</h2>
          <p className="hint">
            Frisch aus Zoho importierte sowie noch nicht verplante Projekte (Leistungsbereich Consulting).
          </p>
        </div>
        <button className="btn-primary" onClick={onSync} disabled={syncing}>
          {syncing ? 'Ruft ab…' : '⟳ Zoho abrufen'}
        </button>
      </div>

      {error && <div className="status err">✕ {error}</div>}
      {syncResult && (
        <div className="status ok">
          ✓ {syncResult.projects_new} neu · {syncResult.projects_updated} aktualisiert (
          {syncResult.projects_upserted} beauftragte Consulting-Angebote insgesamt geprüft)
        </div>
      )}
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
          <span className="dim">{filtered.length} Projekte</span>
        </div>
      )}

      {view && pipeline.length === 0 && (
        <p className="hint">Keine neuen oder noch unverplanten Projekte – alles eingeplant.</p>
      )}
      {view && pipeline.length > 0 && filtered.length === 0 && (
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
                {p.categoryLabel && <span className="proj-tag">{p.categoryLabel}</span>}
                {p.budget_eur != null && <span>{eur.format(Number(p.budget_eur))}</span>}
                {p.budget_days != null && <span>{Number(p.budget_days)} Tage</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
      )}
    </div>
  )
}
