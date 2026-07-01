import { useEffect, useMemo, useState } from 'react'
import {
  deleteMilestone,
  fetchDashboard,
  updateMilestone,
  type DashboardData,
  type Milestone,
  type ProjectLite,
} from '../lib/milestones'
import { toISODate } from '../lib/dates'
import MilestoneForm from './MilestoneForm'

const eurExact = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})
const eur0 = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const dateFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })

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
function relBadge(iso: string | null): string {
  if (!iso) return ''
  const d = daysUntil(iso)
  if (d < 0) return `${Math.abs(d)} Tg. überfällig`
  if (d === 0) return 'heute'
  if (d === 1) return 'morgen'
  return `in ${d} Tg.`
}

/** yyyy-mm eines Datums (lokaler Monat). */
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type MonthBlock = {
  key: string // yyyy-mm
  label: string
  current: boolean
  date: Date // erster Tag des Monats (für die Beschriftung)
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null) // milestone id

  // Letzter / dieser / nächster Monat – aus dem heutigen Datum abgeleitet.
  const months = useMemo<MonthBlock[]>(() => {
    const now = new Date()
    const mk = (offset: number, current: boolean): MonthBlock => {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      return { key: ymOf(d), label: monthFmt.format(d), current, date: d }
    }
    return [mk(-1, false), mk(0, true), mk(1, false)]
  }, [])

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

  // Meilensteine je Monatsblock + Zähler dessen, was außerhalb liegt.
  const { byMonth, outsideCount } = useMemo(() => {
    const keys = new Set(months.map((m) => m.key))
    const byMonth = new Map<string, Milestone[]>()
    months.forEach((m) => byMonth.set(m.key, []))
    let outsideCount = 0
    data?.milestones.forEach((m) => {
      const ym = m.due_date ? m.due_date.slice(0, 7) : null
      if (ym && keys.has(ym)) byMonth.get(ym)!.push(m)
      else outsideCount++
    })
    for (const list of byMonth.values()) {
      list.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    }
    return { byMonth, outsideCount }
  }, [data, months])

  const sumOf = (list: Milestone[]) =>
    list.reduce((s, m) => s + Number(m.amount_eur ?? 0), 0)

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
    const header = ['Projekt', 'Kunde', 'Meilenstein', 'Produkt', 'Fällig', 'Betrag EUR']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = rows.map((m) => {
      const p = projById.get(m.project_id)
      return [
        p?.name ?? '',
        p?.client ?? '',
        m.title,
        m.product ?? '',
        m.due_date ?? '',
        m.amount_eur != null ? String(m.amount_eur) : '',
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

      <div className="dash-actions">
        <button className="btn-ghost" onClick={exportCsv} disabled={!data?.milestones.length}>
          ↓ CSV-Export
        </button>
      </div>

      {data && data.milestones.length === 0 && (
        <p className="hint">Noch keine Meilensteine – sie werden automatisch aus Zoho (Abgrenzungen) gespiegelt.</p>
      )}

      {months.map((mb) => {
        const items = byMonth.get(mb.key) ?? []
        return (
          <section key={mb.key} className="ms-group">
            <h3 className={`ms-group-title${mb.current ? ' is-current' : ''}`}>
              <span className="dot" /> {mb.label}
              <span className="ms-count">{items.length}</span>
              <span className="ms-sum">{eur0.format(sumOf(items))}</span>
            </h3>
            {items.length === 0 ? (
              <p className="ms-empty">Keine Meilensteine in diesem Monat.</p>
            ) : (
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
                        {relBadge(m.due_date) && (
                          <div className={`ms-rel${m.due_date && daysUntil(m.due_date) < 0 ? ' is-over' : ''}`}>
                            {relBadge(m.due_date)}
                          </div>
                        )}
                      </div>
                      <div className="ms-amount">
                        {m.amount_eur != null ? eurExact.format(Number(m.amount_eur)) : '—'}
                      </div>
                      {m.source === 'zoho' ? (
                        <div className="ms-row-actions">
                          <span className="dim" title="Aus Zoho gespiegelt – in Zoho (Abgrenzungen) pflegen">🔒 Zoho</span>
                        </div>
                      ) : (
                        <div className="ms-row-actions">
                          <button className="icon-btn" title="Bearbeiten" onClick={() => setEditing(m.id)}>
                            ✎
                          </button>
                          <button className="icon-btn" title="Löschen" onClick={() => onDelete(m)}>
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
        )
      })}

      {outsideCount > 0 && (
        <p className="ms-outside">
          {outsideCount} weitere{' '}
          {outsideCount === 1 ? 'Meilenstein liegt' : 'Meilensteine liegen'} außerhalb dieser drei
          Monate (oder ohne Datum) und {outsideCount === 1 ? 'wird' : 'werden'} hier nicht angezeigt.
        </p>
      )}
    </div>
  )
}
