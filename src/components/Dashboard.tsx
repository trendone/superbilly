import { useEffect, useMemo, useState } from 'react'
import {
  deleteMilestone,
  fetchDashboard,
  updateMilestone,
  INVOICE_STATES,
  type DashboardData,
  type InvoiceStatus,
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
const dateShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' })
const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
const monthShort = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' })

const WINDOW = 3 // Monate pro Ansicht (Quartalslogik)

function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}
function fmtDateShort(iso: string | null): string {
  return iso ? dateShort.format(parseISO(iso)) : '—'
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
/** Überfällig UND noch nicht in Rechnung gestellt → Handlungsbedarf. */
function needsAction(m: Milestone): boolean {
  return !!m.due_date && daysUntil(m.due_date) < 0 && m.invoice_status === 'offen'
}

/** yyyy-mm eines Datums (lokaler Monat). */
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  offen: 'offen',
  gestellt: 'gestellt',
  bezahlt: 'bezahlt',
}

type MonthBlock = {
  key: string // yyyy-mm
  label: string // z. B. „Juli 2026"
  short: string // z. B. „Jul 26"
  current: boolean
  date: Date // erster Tag des Monats
}

type MonthAgg = {
  block: MonthBlock
  items: Milestone[]
  total: number
  open: number // offen
  sent: number // gestellt
  paid: number // bezahlt
  action: number // Anzahl überfällig & offen
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null) // milestone id
  const [busy, setBusy] = useState<string | null>(null) // milestone id, Status-Wechsel läuft
  const [anchor, setAnchor] = useState(0) // Monats-Offset des Fenster-Starts relativ zu „heute"

  // Fenster aus WINDOW aufeinanderfolgenden Monaten ab dem Anker.
  const months = useMemo<MonthBlock[]>(() => {
    const now = new Date()
    const nowKey = ymOf(now)
    return Array.from({ length: WINDOW }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + anchor + i, 1)
      const key = ymOf(d)
      return {
        key,
        label: monthFmt.format(d),
        short: monthShort.format(d).replace('.', ''),
        current: key === nowKey,
        date: d,
      }
    })
  }, [anchor])

  const windowLabel = useMemo(() => {
    if (months.length === 0) return ''
    return `${months[0].short} – ${months[months.length - 1].short}`
  }, [months])

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

  // Aggregation je sichtbarem Monat + Zähler für Meilensteine ohne/außerhalb Datum.
  const { aggs, undatedCount } = useMemo(() => {
    const idx = new Map<string, MonthAgg>()
    const aggs: MonthAgg[] = months.map((block) => {
      const a: MonthAgg = { block, items: [], total: 0, open: 0, sent: 0, paid: 0, action: 0 }
      idx.set(block.key, a)
      return a
    })
    let undatedCount = 0
    data?.milestones.forEach((m) => {
      if (!m.due_date) {
        undatedCount++
        return
      }
      const a = idx.get(m.due_date.slice(0, 7))
      if (!a) return // liegt außerhalb des sichtbaren Fensters
      a.items.push(m)
      const amt = Number(m.amount_eur ?? 0)
      a.total += amt
      if (m.invoice_status === 'bezahlt') a.paid += amt
      else if (m.invoice_status === 'gestellt') a.sent += amt
      else a.open += amt
      if (needsAction(m)) a.action++
    })
    for (const a of aggs) {
      a.items.sort((x, y) => (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999'))
    }
    return { aggs, undatedCount }
  }, [data, months])

  const maxTotal = useMemo(() => Math.max(1, ...aggs.map((a) => a.total)), [aggs])
  const windowSum = useMemo(() => aggs.reduce((s, a) => s + a.total, 0), [aggs])

  async function cycleStatus(m: Milestone) {
    const cur = INVOICE_STATES.indexOf(m.invoice_status as InvoiceStatus)
    const next = INVOICE_STATES[(cur + 1) % INVOICE_STATES.length]
    setBusy(m.id)
    try {
      const updated = await updateMilestone(m.id, { invoice_status: next })
      setData((d) =>
        d ? { ...d, milestones: d.milestones.map((x) => (x.id === m.id ? updated : x)) } : d,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
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
    const header = ['Projekt', 'Kunde', 'Meilenstein', 'Produkt', 'Fällig', 'Status', 'Betrag EUR']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = rows.map((m) => {
      const p = projById.get(m.project_id)
      return [
        p?.name ?? '',
        p?.client ?? '',
        m.title,
        m.product ?? '',
        m.due_date ?? '',
        m.invoice_status,
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

  const editingMs = editing ? data?.milestones.find((m) => m.id === editing) ?? null : null

  if (loading && !data) return <div className="status pending">… lädt</div>

  return (
    <div className="dash dash-wide">
      {error && <div className="status err">✕ {error}</div>}

      {/* Blätter-Navigation über 3-Monats-Fenster */}
      <div className="ms-forecast-head">
        <div className="ms-nav">
          <button className="icon-btn" title="Frühere Monate" onClick={() => setAnchor((a) => a - WINDOW)}>
            ‹
          </button>
          <span className="ms-nav-label">{windowLabel}</span>
          <button className="icon-btn" title="Spätere Monate" onClick={() => setAnchor((a) => a + WINDOW)}>
            ›
          </button>
          {anchor !== 0 && (
            <button className="btn-ghost ms-today" onClick={() => setAnchor(0)}>
              Heute
            </button>
          )}
        </div>
        <div className="ms-forecast-sum">
          <span className="ms-forecast-sum-label">Fenster gesamt</span>
          <span className="ms-forecast-sum-val">{eur0.format(windowSum)}</span>
        </div>
        <button className="btn-ghost" onClick={exportCsv} disabled={!data?.milestones.length}>
          ↓ CSV-Export
        </button>
      </div>

      {data && data.milestones.length === 0 && (
        <p className="hint">Noch keine Meilensteine – sie werden automatisch aus Zoho (Abgrenzungen) gespiegelt.</p>
      )}

      {/* Balken-Verlauf: erwartete Rechnungssumme je Monat, gestapelt nach Status */}
      <div className="ms-bars">
        {aggs.map((a) => (
          <div key={a.block.key} className={`ms-bar-col${a.block.current ? ' is-current' : ''}`}>
            <div className="ms-bar-track">
              <div className="ms-bar-fill" style={{ height: `${(a.total / maxTotal) * 100}%` }}>
                {a.paid > 0 && (
                  <div className="ms-bar-seg seg-bezahlt" style={{ flexGrow: a.paid }} />
                )}
                {a.sent > 0 && (
                  <div className="ms-bar-seg seg-gestellt" style={{ flexGrow: a.sent }} />
                )}
                {a.open > 0 && (
                  <div className="ms-bar-seg seg-offen" style={{ flexGrow: a.open }} />
                )}
              </div>
            </div>
            <div className="ms-bar-val">{eur0.format(a.total)}</div>
            <div className="ms-bar-mon">{a.block.short}</div>
          </div>
        ))}
      </div>
      <div className="ms-legend">
        <span><i className="lg seg-bezahlt" /> bezahlt</span>
        <span><i className="lg seg-gestellt" /> gestellt</span>
        <span><i className="lg seg-offen" /> offen</span>
      </div>

      {/* Bearbeitungs-Formular (voll­breit, wenn ein Meilenstein bearbeitet wird) */}
      {editingMs && data && (
        <MilestoneForm
          projects={data.projects}
          initial={editingMs}
          onCancel={() => setEditing(null)}
          onSave={async (vals) => {
            const updated = await updateMilestone(editingMs.id, vals)
            setData((d) =>
              d
                ? { ...d, milestones: d.milestones.map((x) => (x.id === editingMs.id ? updated : x)) }
                : d,
            )
            setEditing(null)
          }}
        />
      )}

      {/* Drei Monats-Spalten nebeneinander */}
      <div className="ms-cols">
        {aggs.map((a) => (
          <section key={a.block.key} className={`ms-col${a.block.current ? ' is-current' : ''}`}>
            <header className="ms-col-head">
              <span className="ms-col-mon">{a.block.label}</span>
              <span className="ms-col-sum">{eur0.format(a.total)}</span>
              <span className="ms-col-meta">
                {a.items.length} {a.items.length === 1 ? 'Posten' : 'Posten'}
                {a.action > 0 && <span className="ms-col-action"> · {a.action} überfällig</span>}
              </span>
            </header>
            {a.items.length === 0 ? (
              <p className="ms-empty">Keine Meilensteine.</p>
            ) : (
              <div className="ms-col-list">
                {a.items.map((m) => {
                  const p = projById.get(m.project_id)
                  const st = m.invoice_status as InvoiceStatus
                  const over = m.due_date && daysUntil(m.due_date) < 0
                  return (
                    <div key={m.id} className={`ms-card${needsAction(m) ? ' needs-action' : ''}`}>
                      <span
                        className="ms-color"
                        style={{ background: p?.color ?? '#94a3b8' }}
                      />
                      <div className="ms-card-body">
                        <div className="ms-card-top">
                          <span className="ms-title">{m.title}</span>
                          <span className="ms-amount">
                            {m.amount_eur != null ? eurExact.format(Number(m.amount_eur)) : '—'}
                          </span>
                        </div>
                        <div className="ms-sub">
                          {p?.name ?? '—'}
                          {p?.client ? ` · ${p.client}` : ''}
                        </div>
                        <div className="ms-card-foot">
                          <span className="ms-due">
                            {fmtDateShort(m.due_date)}
                            {relBadge(m.due_date) && (
                              <span className={`ms-rel${over ? ' is-over' : ''}`}>
                                {' · '}
                                {relBadge(m.due_date)}
                              </span>
                            )}
                          </span>
                          <button
                            className={`ms-status st-${st}`}
                            title="Status wechseln (offen → gestellt → bezahlt)"
                            disabled={busy === m.id}
                            onClick={() => cycleStatus(m)}
                          >
                            {STATUS_LABEL[st] ?? st}
                          </button>
                          {m.source === 'zoho' ? (
                            <span className="dim ms-lock" title="Aus Zoho gespiegelt – in Zoho pflegen">
                              🔒
                            </span>
                          ) : (
                            <span className="ms-card-actions">
                              <button className="icon-btn" title="Bearbeiten" onClick={() => setEditing(m.id)}>
                                ✎
                              </button>
                              <button className="icon-btn" title="Löschen" onClick={() => onDelete(m)}>
                                🗑
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      {undatedCount > 0 && (
        <p className="ms-outside">
          {undatedCount} {undatedCount === 1 ? 'Meilenstein hat' : 'Meilensteine haben'} kein
          Fälligkeitsdatum und {undatedCount === 1 ? 'wird' : 'werden'} hier nicht angezeigt.
        </p>
      )}
    </div>
  )
}
