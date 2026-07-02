import { useEffect, useMemo, useState } from 'react'
import {
  capacityCheck,
  fetchPipelineDeals,
  forecastFor,
  forecastHorizon,
  triggerPipelineSync,
  type PipelineDeal,
  type PipelineSyncResult,
} from '../lib/pipeline'
import { fetchAnalytics, type AnalyticsData } from '../lib/analytics'

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const d1 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
const short = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–'

export default function PipelineForecast() {
  const [deals, setDeals] = useState<PipelineDeal[] | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<PipelineSyncResult | null>(null)

  function load() {
    Promise.all([fetchPipelineDeals(), fetchAnalytics()])
      .then(([d, a]) => {
        setDeals(d)
        setAnalytics(a)
        setSelected(new Set(d.map((x) => x.external_id))) // Default: alle aktiv
      })
      .catch((e) => setError((e as Error).message ?? String(e)))
  }
  useEffect(load, [])

  async function onSync() {
    setSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      const res = await triggerPipelineSync()
      setSyncResult(res)
      load()
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setSyncing(false)
    }
  }

  // Forecast je Deal (erwartete/gewichtete Tage, Zeitraum, Monatslast).
  const forecasts = useMemo(() => (deals ?? []).map(forecastFor), [deals])
  const selForecasts = useMemo(
    () => forecasts.filter((f) => selected.has(f.deal.external_id)),
    [forecasts, selected],
  )
  const months = useMemo(() => forecastHorizon(forecasts), [forecasts])
  const check = useMemo(
    () => (analytics ? capacityCheck(analytics, selForecasts, months) : []),
    [analytics, selForecasts, months],
  )
  // Nur Monate mit Last oder freier Kapazität anzeigen (schlanker).
  const checkRows = useMemo(() => check.filter((m) => m.pipelineLoad > 0 || m.freeDays > 0), [check])
  const maxDay = useMemo(() => Math.max(1, ...check.map((m) => Math.max(m.freeDays, m.pipelineLoad))), [check])

  const sum = useMemo(() => {
    let vol = 0, exp = 0, wgt = 0
    for (const f of selForecasts) {
      vol += f.deal.amount_eur != null ? Number(f.deal.amount_eur) : 0
      exp += f.expectedDays
      wgt += f.weightedDays
    }
    return { vol, exp, wgt }
  }, [selForecasts])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="dash">
      <div className="ana-head">
        <div>
          <h2 className="admin-h">Pipeline-Forecast</h2>
          <p className="hint">
            Offene Zoho-Deals (Angebot versendet / Verhandlungsphase, Consulting) als weiche,
            wahrscheinlichkeitsgewichtete Last. Erscheint nicht in der Planung.
          </p>
        </div>
        <button className="btn-primary" onClick={onSync} disabled={syncing}>
          {syncing ? 'Ruft ab…' : '⟳ Pipeline abrufen'}
        </button>
      </div>

      {error && <div className="status err">✕ {error}</div>}
      {syncResult && <div className="status ok">✓ {syncResult.deals_synced} offene Deals gespiegelt</div>}
      {!deals && !error && <div className="status pending">… lädt</div>}

      {deals && deals.length === 0 && (
        <p className="hint">Keine offenen Consulting-Deals in Verhandlung. „⟳ Pipeline abrufen" holt den aktuellen Stand.</p>
      )}

      {deals && deals.length > 0 && (
        <>
          <div className="pf-summary">
            <span><b>{selForecasts.length}</b> von {deals.length} Deals gewählt</span>
            <span>Volumen <b>{eur.format(sum.vol)}</b></span>
            <span>erwartet <b>{d1(sum.exp)}</b> T</span>
            <span>gewichtet <b>{d1(sum.wgt)}</b> T</span>
          </div>

          {/* Kapazitäts-Check: gewichtete Last vs. freie Team-Kapazität je Monat */}
          <h3 className="pf-h3">Kapazitäts-Check</h3>
          <div className="table-scroll">
            <table className="ana-table">
              <thead>
                <tr>
                  <th>Monat</th>
                  <th className="num">Frei (T)</th>
                  <th className="num">Pipeline (T)</th>
                  <th>Auslastung</th>
                </tr>
              </thead>
              <tbody>
                {checkRows.map((m) => {
                  const pct = m.freeDays > 0 ? Math.round((m.pipelineLoad / m.freeDays) * 100) : m.pipelineLoad > 0 ? 999 : 0
                  const cls = m.health === 'over' ? 'red' : m.health === 'tight' ? 'amber' : 'green'
                  return (
                    <tr key={`${m.year}-${m.month}`}>
                      <td>{m.label}</td>
                      <td className="num dim">{d1(m.freeDays)}</td>
                      <td className={`num ${cls}`}>{m.pipelineLoad > 0 ? d1(m.pipelineLoad) : '–'}</td>
                      <td>
                        <div className="pf-bars" title={`${pct}% der freien Kapazität`}>
                          <span className="pf-bar-free" style={{ width: `${(m.freeDays / maxDay) * 100}%` }} />
                          <span className={`pf-bar-load ${cls}`} style={{ width: `${(m.pipelineLoad / maxDay) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint pf-legend">
            <span className="pf-key pf-key-free" /> freie Team-Kapazität ·{' '}
            <span className="pf-key pf-key-load" /> gewichtete Pipeline-Last ·{' '}
            <span className="dot" style={{ background: 'var(--red)' }} /> Überlast
          </p>

          {/* Was-wäre-wenn: Deals einzeln zu-/abschalten */}
          <h3 className="pf-h3">Deals (Was-wäre-wenn)</h3>
          <div className="table-scroll">
            <table className="ana-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Deal</th>
                  <th>Kunde</th>
                  <th>Stage</th>
                  <th className="num">Volumen</th>
                  <th className="num">Wahrsch.</th>
                  <th className="num">erw. T</th>
                  <th className="num">gew. T</th>
                  <th>Zeitraum</th>
                </tr>
              </thead>
              <tbody>
                {forecasts.map((f) => {
                  const on = selected.has(f.deal.external_id)
                  return (
                    <tr key={f.deal.external_id} className={on ? '' : 'pf-off'}>
                      <td>
                        <input type="checkbox" checked={on} onChange={() => toggle(f.deal.external_id)} />
                      </td>
                      <td>{f.deal.name}</td>
                      <td className="dim">{f.deal.client ?? '–'}</td>
                      <td>{f.deal.stage ?? '–'}</td>
                      <td className="num">{f.deal.amount_eur != null ? eur.format(Number(f.deal.amount_eur)) : '–'}</td>
                      <td className="num">{f.deal.probability != null ? `${f.deal.probability}%` : '–'}</td>
                      <td className="num dim">{d1(f.expectedDays)}</td>
                      <td className="num"><b>{d1(f.weightedDays)}</b></td>
                      <td className="dim">
                        {f.start ? `${short(f.deal.closing_date)} · ${f.weeks} Wo.` : 'kein Abschlussdatum'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
