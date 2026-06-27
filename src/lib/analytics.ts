// Auswertungs-Datenschicht: Aggregationen für Projekt- und Mitarbeiter-Auslastung.
// Spiegelt die alte Billy-„auswertung.html", aber gerechnet auf dem Supabase-Modell:
//  - produktive Projekte  = projects.is_system = false  (haben budget_days)
//  - Abwesenheit          = System-Kategorien Urlaub / Krank / Frei / Kurzarbeit
//  - interne Zeit (Admin) = System-Kategorie, separat ausgewiesen (kein „Abwesend")
// Periodische Wochenstunden via employee_hours_periods, Feiertage via holidays.ts.

import { supabase } from './supabase'
import type { Database } from './database.types'
import { holidayName } from './holidays'
import { toISODate } from './dates'

export type Employee = Database['public']['Tables']['employees']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type HoursPeriod = Database['public']['Tables']['employee_hours_periods']['Row']

// System-Kategorien, die echte Abwesenheit darstellen (mindern die Verfügbarkeit).
export const ABSENCE_CATEGORIES = ['Urlaub', 'Krank', 'Frei', 'Kurzarbeit'] as const

export interface AnalyticsData {
  employees: Employee[]
  projects: Project[]
  bookings: Booking[]
  hoursPeriods: HoursPeriod[]
}

/** Lädt alle Daten, die beide Auswertungen brauchen, in einem Rutsch. */
export async function fetchAnalytics(): Promise<AnalyticsData> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')

  const [emp, proj, book, periods] = await Promise.all([
    supabase.from('employees').select('*').eq('active', true).order('name'),
    supabase.from('projects').select('*').order('name'),
    supabase.from('bookings').select('*'),
    supabase.from('employee_hours_periods').select('*'),
  ])

  if (emp.error) throw emp.error
  if (proj.error) throw proj.error
  if (book.error) throw book.error
  if (periods.error) throw periods.error

  return {
    employees: emp.data,
    projects: proj.data,
    bookings: book.data,
    hoursPeriods: periods.data,
  }
}

// ── Helfer ───────────────────────────────────────────────────────────────

/** Geltende Wochenstunden für ein Datum (jüngste Periode ≤ Datum, sonst Default). */
export function weeklyHoursForDate(
  emp: Employee,
  periods: HoursPeriod[],
  iso: string,
): number {
  let hours = Number(emp.weekly_hours)
  let best: HoursPeriod | null = null
  for (const p of periods) {
    if (p.employee_id !== emp.id) continue
    if (p.valid_from <= iso && (!best || p.valid_from > best.valid_from)) best = p
  }
  return best ? Number(best.weekly_hours) : hours
}

/** Zählt Arbeitstage (Mo–Fr) ohne Feiertage im Bereich [startISO..endISO] inkl. */
function workdaysNoHolidays(startISO: string, endISO: string): number {
  let count = 0
  const d = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T00:00:00`)
  while (d <= end) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6 && !holidayName(toISODate(d))) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

const isAbsence = (p: Project | undefined) =>
  !!p && p.is_system && (ABSENCE_CATEGORIES as readonly string[]).includes(p.name)

// ── Projekt-Auswertung ─────────────────────────────────────────────────────

export interface ProjectStat {
  project: Project
  bookedDays: number
  budgetDays: number | null
  diffDays: number | null
  rangeStart: string | null
  rangeEnd: string | null
  employeeNames: string[]
}

/** Gebuchte Tage je Buchung = Arbeitstage (ohne Feiertage) × Tagessatz (budget). */
function bookingDays(b: Booking): number {
  return workdaysNoHolidays(b.start_date, b.end_date) * Number(b.budget)
}

/** Aggregiert produktive (Nicht-System-)Projekte: gebucht/Budget/Diff/Zeitraum/MA. */
export function projectStats(data: AnalyticsData): ProjectStat[] {
  const empName = new Map(data.employees.map((e) => [e.id, e.name]))
  const projects = data.projects.filter((p) => !p.is_system)

  return projects.map((project) => {
    const tasks = data.bookings.filter((b) => b.project_id === project.id)
    const bookedDays = tasks.reduce((sum, b) => sum + bookingDays(b), 0)
    const budgetDays = project.budget_days
    const diffDays = budgetDays != null ? budgetDays - bookedDays : null

    let rangeStart: string | null = null
    let rangeEnd: string | null = null
    for (const b of tasks) {
      if (rangeStart === null || b.start_date < rangeStart) rangeStart = b.start_date
      if (rangeEnd === null || b.end_date > rangeEnd) rangeEnd = b.end_date
    }

    const employeeNames = [...new Set(tasks.map((b) => b.employee_id))]
      .map((id) => empName.get(id) ?? '?')
      .sort()

    return {
      project,
      bookedDays: Math.round(bookedDays * 10) / 10,
      budgetDays,
      diffDays: diffDays != null ? Math.round(diffDays * 10) / 10 : null,
      rangeStart,
      rangeEnd,
      employeeNames,
    }
  })
}

// ── Mitarbeiter-Auswertung ─────────────────────────────────────────────────

export interface MonthWindow {
  year: number
  month: number // 0-basiert
  label: string
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Monatsfenster relativ zu „heute": offsets z. B. -2..+3. */
export function monthWindow(today: Date, from: number, to: number): MonthWindow[] {
  const out: MonthWindow[] = []
  for (let off = from; off <= to; off++) {
    const d = new Date(today.getFullYear(), today.getMonth() + off, 1)
    out.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
    })
  }
  return out
}

export interface MonthStat {
  label: string
  pct: number // produktive Auslastung in %
  bookedHours: number // produktive Stunden
  netCapacityHours: number // verfügbare Stunden (Kapazität − Abwesenheit)
  absenceDays: number
  absenceHours: number
  adminDays: number
  projectNames: string[]
}

/**
 * Monats-Auslastung eines Mitarbeiters – tagesgenau, damit unterjährig
 * wechselnde Wochenstunden korrekt zählen (wie in der alten App).
 */
export function employeeMonthStats(
  emp: Employee,
  data: AnalyticsData,
  months: MonthWindow[],
): MonthStat[] {
  const projById = new Map(data.projects.map((p) => [p.id, p]))
  const empBookings = data.bookings.filter((b) => b.employee_id === emp.id)

  return months.map((m) => {
    const firstDay = new Date(m.year, m.month, 1)
    const lastDay = new Date(m.year, m.month + 1, 0)
    const monthStart = toISODate(firstDay)
    const monthEnd = toISODate(lastDay)

    const monthBookings = empBookings.filter(
      (b) => b.end_date >= monthStart && b.start_date <= monthEnd,
    )

    let capacityH = 0
    let bookedH = 0
    let absenceH = 0
    let absenceDays = 0
    let adminDays = 0
    const projSet = new Set<string>()

    const cur = new Date(firstDay)
    while (cur <= lastDay) {
      const dow = cur.getDay()
      const iso = toISODate(cur)
      if (dow >= 1 && dow <= 5 && !holidayName(iso)) {
        const hoursPerDay = weeklyHoursForDate(emp, data.hoursPeriods, iso) / 5
        capacityH += hoursPerDay
        for (const b of monthBookings) {
          if (b.start_date > iso || b.end_date < iso) continue
          const p = projById.get(b.project_id)
          const share = Number(b.budget)
          if (isAbsence(p)) {
            absenceDays += share
            absenceH += share * hoursPerDay
          } else if (p && p.is_system) {
            // Admin u. ä. – interne Zeit, separat
            adminDays += share
          } else {
            bookedH += share * hoursPerDay
            if (p) projSet.add(p.name)
          }
        }
      }
      cur.setDate(cur.getDate() + 1)
    }

    const netCapacityHours = capacityH - absenceH
    const pct = netCapacityHours > 0 ? Math.round((bookedH / netCapacityHours) * 100) : 0

    return {
      label: m.label,
      pct,
      bookedHours: Math.round(bookedH * 10) / 10,
      netCapacityHours: Math.round(netCapacityHours * 10) / 10,
      absenceDays: Math.round(absenceDays * 10) / 10,
      absenceHours: Math.round(absenceH * 10) / 10,
      adminDays: Math.round(adminDays * 10) / 10,
      projectNames: [...projSet].sort(),
    }
  })
}
