import { useEffect, useMemo, useState } from 'react'
import {
  createMilestone,
  deleteMilestone,
  fetchDashboard,
  INVOICE_STATES,
  updateMilestone,
  type DashboardData,
  type Milestone,
  type ProjectLite,
} from '../lib/milestones'
import { addDays, mondayOf, toISODate } from '../lib/dates'
import MilestoneForm from './MilestoneForm'

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const eurExact = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})
const dateFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}
function fmtDate(iso: string | null): string {
  return iso ? dateFmt.format(parseISO(iso)) : '—'
}
function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((parseISO(iso).getTime() - today.getTime()) / 86400000)
}

type Bucket = 'overdue' | 'week' | 'next30' | 'later' | 'nodate' | 'done'

const BUCKET_META: Record<Bucket, { label: string; tone: string }> = {
  overdue: { label: 'Überfällig', tone: 'red' },
  week: { label: 'Diese Woche fällig', tone: 'orange' },
  next30: { label: 'Nächste 30 Tage', tone: 'amber' },
  later: { label: 'Später', tone: 'neutral' },
  nodate: { label: 'Ohne Datum', tone: 'neutral' },
  done: { label: 'Bezahlt', tone: 'green' },
}
const BUCKET_ORDER: Bucket[] = ['overdue', 'week', 'next30', 'later', 'nodate', 'done']

function bucketOf(m: Milestone, endOfWeekISO: string): Bucket {
  if (m.invoice_status === 'bezahlt') return 'done'
  if (!m.due_date) return 'nodate'
  const d = daysUntil(m.due_date)
  if (d < 0) return 'overdue'
  if (m.due_date <= endOfWeekISO) return 'week'
  if (d <= 30) return 'next30'
  return 'later'
}

function relBadge(m: Milestone): string {
  if (!m.due_date) return ''
  const d = daysUntil(m.due_date)
  if (d < 0) return `${Math.abs(d)} Tg. überfällig`
  if (d === 0) return 'heute'
  if (d === 1) return 'morgen'
  return `in ${d} Tg.`
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null) // milestone id
  const [adding, setAdding] = useState(false)

  const endOfWeekISO = useMemo(() => toISODate(addDays(mondayOf(new Date()), 6)), [])

  function load() {
    setLoading(true)
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const projById = useMemo(() => {
    const m = new Map<string, ProjectLite>()
    data?.projects.forEach((p) => m.set(p.id, p))
    return m
  }, [data])

  const grouped = useMemo(() => {
    const g: Record<Bucket, Milestone[]> = {
      overdue: [],
      week: [],
      next30: [],
      later: [],
      nodate: [],
      done: [],
    }
    data?.milestones.forEach((m) => g[bucketOf(m, endOfWeekISO)].push(m))
    // innerhalb der Gruppe nach Fälligkeit sortieren (ohne Datum ans Ende)
    for (const k of BUCKET_ORDER) {
      g[k as Bucket].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    }
    return g
  }, [data, endOfWeekISO])

  const kpis = useMemo(() => {
    let offen = 0,
      gestellt = 0,
      bezahlt = 0,
      overdueCount = 0
    data?.milestones.forEach((m) => {
      const a = Number(m.amount_eur ?? 0)
      if (m.invoice_status === 'offen') offen += a
      else if (m.invoice_status === 'gestellt') gestellt += a
      else if (m.invoice_status === 'bezahlt') bezahlt += a
      if (m.invoice_status !== 'bezahlt' && m.due_date && daysUntil(m.due_date) < 0) overdueCount++
    })
    return { offen, gestellt, bezahlt, overdueCount }
  }, [data])

  async function onStatus(m: Milestone, status: string) {
    try {
      const updated = await updateMilestone(m.id, { invoice_status: status })
      setData((d) =>
        d ? { ...d, milestones: d.milestones.map((x) => (x.id === m.id ? updated : x)) } : d,
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function onDelete(m: Milestone) {
    if (!confirm(`Meilenstein „${m.title}" löschen?`)) return
    try {
      await deleteMilestone(m.id)
      setData((d) => (d ? { ...d, milestones: d.milestones.filter((x) => x.id !== m.id) } : d))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function exportCsv() {
    const rows = [...(data?.milestones ?? [])].sort((a, b) =>
      (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
    )
    const header = ['Projekt', 'Kunde', 'Meilenstein', 'Fällig', 'Betrag EUR', 'Status']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = rows.map((m) => {
      const p = projById.get(m.project_id)
      return [
        p?.name ?? '',
        p?.client ?? '',
        m.title,
        m.due_date ?? '',
        m.amount_eur != null ? String(m.amount_eur) : '',
        m.invoice_status,
      ]
        .map((v) => esc(String(v)))
        .join(';')
    })
    const csv = '﻿' + [header.join(';'), ...lines].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `meilensteine_${toISODate(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !data) return <div className="status pending">… lädt</div>

  return (
    <div className="dash">
      {error && <div className="status err">✕ {error}</div>}

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Offen (noch nicht gestellt)</div>
          <div className="kpi-val">{eur.format(kpis.offen)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Gestellt (ausstehend)</div>
          <div className="kpi-val">{eur.format(kpis.gestellt)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bezahlt</div>
          <div className="kpi-val">{eur.format(kpis.bezahlt)}</div>
        </div>
        <div className={`kpi${kpis.overdueCount ? ' kpi-alert' : ''}`}>
          <div className="kpi-label">Überfällig</div>
          <div className="kpi-val">{kpis.overdueCount}</div>
        </div>
      </div>

      <div className="dash-actions">
        <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? '× Abbrechen' : '+ Meilenstein'}
        </button>
        <button className="btn-ghost" onClick={exportCsv} disabled={!data?.milestones.length}>
          ↓ CSV-Export
        </button>
      </div>

      {adding && data && (
        <MilestoneForm
          projects={data.projects}
          onCancel={() => setAdding(false)}
          onSave={async (vals) => {
            const created = await createMilestone(vals)
            setData((d) => (d ? { ...d, milestones: [...d.milestones, created] } : d))
            setAdding(false)
          }}
        />
      )}

      {data && data.milestones.length === 0 && !adding && (
        <p className="hint">Noch keine Meilensteine. Lege den ersten mit „+ Meilenstein" an.</p>
      )}

      {BUCKET_ORDER.map((b) => {
        const items = grouped[b]
        if (!items.length) return null
        const meta = BUCKET_META[b]
        return (
          <section key={b} className="ms-group">
            <h3 className={`ms-group-title tone-${meta.tone}`}>
              <span className="dot" /> {meta.label}
              <span className="ms-count">{items.length}</span>
            </h3>
            <div className="ms-list">
              {items.map((m) =>
                editing === m.id && data ? (
                  <MilestoneForm
                    key={m.id}
                    projects={data.projects}
                    initial={m}
                    onCancel={() => setEditing(null)}
                    onSave={async (vals) => {
                      const updated = await updateMilestone(m.id, vals)
                      setData((d) =>
                        d
                          ? {
                              ...d,
                              milestones: d.milestones.map((x) => (x.id === m.id ? updated : x)),
                            }
                          : d,
                      )
                      setEditing(null)
                    }}
                  />
                ) : (
                  <div key={m.id} className="ms-row">
                    <span
                      className="ms-color"
                      style={{ background: projById.get(m.project_id)?.color ?? '#94a3b8' }}
                    />
                    <div className="ms-main">
                      <div className="ms-title">{m.title}</div>
                      <div className="ms-sub">
                        {projById.get(m.project_id)?.name ?? '—'}
                        {projById.get(m.project_id)?.client
                          ? ` · ${projById.get(m.project_id)?.client}`
                          : ''}
                      </div>
                    </div>
                    <div className="ms-due">
                      <div>{fmtDate(m.due_date)}</div>
                      {m.invoice_status !== 'bezahlt' && relBadge(m) && (
                        <div className={`ms-rel${m.due_date && daysUntil(m.due_date) < 0 ? ' is-over' : ''}`}>
                          {relBadge(m)}
                        </div>
                      )}
                    </div>
                    <div className="ms-amount">
                      {m.amount_eur != null ? eurExact.format(Number(m.amount_eur)) : '—'}
                    </div>
                    <select
                      className={`ms-status st-${m.invoice_status}`}
                      value={m.invoice_status}
                      onChange={(e) => onStatus(m, e.target.value)}
                    >
                      {INVOICE_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <div className="ms-row-actions">
                      <button className="icon-btn" title="Bearbeiten" onClick={() => setEditing(m.id)}>
                        ✎
                      </button>
                      <button className="icon-btn" title="Löschen" onClick={() => onDelete(m)}>
                        🗑
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
