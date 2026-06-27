// Gesetzliche Feiertage für das Bundesland Hamburg (Firmensitz).
// Hamburg hat: Neujahr, Karfreitag, Ostermontag, Tag der Arbeit,
// Christi Himmelfahrt, Pfingstmontag, Tag der Deutschen Einheit,
// Reformationstag (seit 2018), 1. + 2. Weihnachtstag.
// NICHT in HH: Hl. Drei Könige, Fronleichnam, Mariä Himmelfahrt,
// Allerheiligen, Buß- und Bettag.

import { toISODate } from './dates'

/** Ostersonntag (Gauß/Meeus, gregorianisch) als lokales Date. */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function plusDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const cache = new Map<number, Record<string, string>>()

/** Alle Hamburger Feiertage eines Jahres als { 'YYYY-MM-DD': Name }. */
export function holidaysForYear(year: number): Record<string, string> {
  const cached = cache.get(year)
  if (cached) return cached

  const easter = easterSunday(year)
  const map: Record<string, string> = {
    [`${year}-01-01`]: 'Neujahr',
    [toISODate(plusDays(easter, -2))]: 'Karfreitag',
    [toISODate(plusDays(easter, 1))]: 'Ostermontag',
    [`${year}-05-01`]: 'Tag der Arbeit',
    [toISODate(plusDays(easter, 39))]: 'Christi Himmelfahrt',
    [toISODate(plusDays(easter, 50))]: 'Pfingstmontag',
    [`${year}-10-03`]: 'Tag der Deutschen Einheit',
    [`${year}-10-31`]: 'Reformationstag',
    [`${year}-12-25`]: '1. Weihnachtstag',
    [`${year}-12-26`]: '2. Weihnachtstag',
  }
  cache.set(year, map)
  return map
}

/** Feiertagsname für ein ISO-Datum (YYYY-MM-DD) oder null. */
export function holidayName(iso: string): string | null {
  const year = Number(iso.slice(0, 4))
  return holidaysForYear(year)[iso] ?? null
}

export function isHoliday(iso: string): boolean {
  return holidayName(iso) !== null
}
