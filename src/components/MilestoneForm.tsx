import { useState } from 'react'
import { INVOICE_STATES, type Milestone, type ProjectLite } from '../lib/milestones'

export interface MilestoneFormValues {
  project_id: string
  title: string
  due_date: string | null
  amount_eur: number | null
  invoice_status: string
}

/**
 * Anlegen/Bearbeiten eines Meilensteins. `projects` bestimmt die Auswahl –
 * mit genau einem Eintrag (z. B. aus dem Projekt-Detail) ist das Projekt fix.
 */
export default function MilestoneForm({
  projects,
  initial,
  onSave,
  onCancel,
}: {
  projects: ProjectLite[]
  initial?: Milestone
  onSave: (vals: MilestoneFormValues) => Promise<void>
  onCancel: () => void
}) {
  const [projectId, setProjectId] = useState(initial?.project_id ?? projects[0]?.id ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [amount, setAmount] = useState(initial?.amount_eur != null ? String(initial.amount_eur) : '')
  const [status, setStatus] = useState(initial?.invoice_status ?? 'offen')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const lockedProject = projects.length === 1

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !title.trim()) {
      setErr('Projekt und Titel sind Pflicht.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onSave({
        project_id: projectId,
        title: title.trim(),
        due_date: dueDate || null,
        amount_eur: amount.trim() === '' ? null : Number(amount.replace(',', '.')),
        invoice_status: status,
      })
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <form className="ms-form" onSubmit={submit}>
      <div className="ms-form-grid">
        {!lockedProject && (
          <label>
            Projekt
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.client ? ` (${p.client})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Meilenstein
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z. B. Abnahme Phase 1"
          />
        </label>
        <label>
          Fällig am
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label>
          Betrag (EUR)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="z. B. 12000"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {INVOICE_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {err && <div className="status err">✕ {err}</div>}
      <div className="ms-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichert…' : initial ? 'Speichern' : 'Anlegen'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}
