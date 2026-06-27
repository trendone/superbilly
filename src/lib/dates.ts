// Datums-Helfer für die Wochenansicht (lokale Zeit, keine UTC-Verschiebung).

export const dayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr'] as const

export function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = So … 6 = Sa
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDay(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
}

/** Zählt Arbeitstage (Mo–Fr) im Bereich [startISO..endISO] inklusive. */
export function workingDaysBetween(startISO: string, endISO: string): number {
  let count = 0
  const d = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T00:00:00`)
  while (d <= end) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return (
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    )
  )
}
