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

/** Wochentags-Kürzel aus dem echten Datum (nicht aus der Spaltenposition –
 *  ein Monatsraster startet an einem beliebigen Wochentag). */
export function weekdayLabel(date: Date): string {
  return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()]
}

/** Erster Tag des Monats, auf Mitternacht normalisiert. */
export function startOfMonth(date: Date): Date {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Monatssprung ausgehend vom Monatsersten (kein Überlauf bei 31 Tagen). */
export function addMonths(date: Date, n: number): Date {
  const d = startOfMonth(date)
  d.setMonth(d.getMonth() + n)
  return d
}

/** Alle Werktage (Mo–Fr) des Monats, in dem `date` liegt. */
export function workingDaysOfMonth(date: Date): Date[] {
  const d = startOfMonth(date)
  const month = d.getMonth()
  const out: Date[] = []
  while (d.getMonth() === month) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
export function formatMonth(date: Date): string {
  return monthFmt.format(date)
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
