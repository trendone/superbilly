// Auswertungs-Datenschicht: Aggregationen für Projekt- und Mitarbeiter-Auslastung.
// Gerechnet auf dem Supabase-Modell:
//  - produktive Projekte  = projects.is_system = false  (haben budget_days/eur)
//  - Abwesenheit          = System-Kategorien Urlaub / Krank / Frei / Kurzarbeit
//  - interne Zeit (Admin) = System-Kategorie, separat ausgewiesen
// Periodische Wochenstunden via employee_hours_periods, Feiertage via holidays.ts,
// Fakturastand via milestones, Ist-Stunden via actuals.

import { supabase } from './supabase'
import type { Database } from './database.types'
import { holidayName } from './holidays'
import { toISODate } from './dates'

export type Employee = Database['public']['Tables']['employees']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type HoursPeriod = Database['public']['Tables']['employee_hours_periods']['Row']
export type Milestone = Database['public']['Tables']['milestones']['Row']
export type Actual = Database['public']['Tables']['actuals']['Row']
export type ProjectActual = Database['public']['Tables']['project_actuals']['Row']
export type Department = Database['public']['Tables']['departments']['Row']

// System-Kategorien, die echte Abwesenheit darstellen (mindern die Verfügbarkeit).
export const ABSENCE_CATEGORIES = ['Urlaub', 'Krank', 'Frei', 'Kurzarbeit'] as const

// Stunden pro „Personentag" (für die Umrechnung Ist-Stunden → Tage).
const HOURS_PER_DAY = 8

export interface AnalyticsData {
  employees: Employee[]
  projects: Project[]
  bookings: Booking[]
  hoursPeriods: HoursPeriod[]
  milestones: Milestone[]
  actuals: Actual[]
  projectActuals: ProjectActual[] // Ist-Zeiten aus Mite (project_actuals)
  departments: Department[]
}

// PostgREST liefert pro Request standardmäßig max. 1000 Zeilen. Für Tabellen, die
// das überschreiten können (bookings), seitenweise nachladen, sonst fehlen Daten
// in der Auswertung (z. B. Mitarbeiter mit 0 %, obwohl verplant).
const PAGE = 1000
async function fetchAll<T>(table: 'bookings'): Promise<T[]> {
  const s = supabase!
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await s.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return out
}

/** Lädt alle Daten, die beide Auswertungen brauchen, in einem Rutsch. */
export async function fetchAnalytics(): Promise<AnalyticsData> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')

  const [emp, proj, book, periods, ms, act, pact, dep] = await Promise.all([
    supabase.from('employees').select('*').eq('active', true).order('name'),
    supabase.from('projects').select('*').order('name'),
    fetchAll<Booking>('bookings'),
    supabase.from('employee_hours_periods').select('*'),
    supabase.from('milestones').select('*'),
    supabase.from('actuals').select('*'),
    supabase.from('project_actuals').select('*'),
    supabase.from('departments').select('*').order('sort_order').order('name'),
  ])

  if (emp.error) throw emp.error
  if (proj.error) throw proj.error
  if (periods.error) throw periods.error
  if (ms.error) throw ms.error
  if (act.error) throw act.error
  if (pact.error) throw pact.error
  if (dep.error) throw dep.error

  return {
    employees: emp.data,
    projects: proj.data,
    bookings: book,
    hoursPeriods: periods.data,
    milestones: ms.data,
    actuals: act.data,
    projectActuals: pact.data,
    departments: dep.data,
  }
}

// ── Helfer ───────────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10
const todayISO = () => toISODate(new Date())

/** Geltende Wochenstunden für ein Datum (jüngste Periode ≤ Datum, sonst Default). */
export function weeklyHoursForDate(emp: Employee, periods: HoursPeriod[], iso: string): number {
  let best: HoursPeriod | null = null
  for (const p of periods) {
    if (p.employee_id !== emp.id) continue
    if (p.valid_from <= iso && (!best || p.valid_from > best.valid_from)) best = p
  }
  return best ? Number(best.weekly_hours) : Number(emp.weekly_hours)
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

// Leistungskategorie aus dem Produktnamen "Bereich / Leistungstyp / KTR".
export interface ProductCategory { raw: string; label: string; ktr: string | null }
export function parseProduct(raw: string | null | undefined): ProductCategory | null {
  if (!raw) return null
  const parts = raw.split(' / ').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const last = parts[parts.length - 1]
  if (/^\d+$/.test(last)) {
    return { raw, label: parts.slice(1, -1).join(' / ') || parts[0], ktr: last }
  }
  return { raw, label: parts.length > 1 ? parts.slice(1).join(' / ') : parts[0], ktr: null }
}
// KTR-Nummern, die als „Keynote" gelten und ausgefiltert werden können.
export const KEYNOTE_KTR = ['50100', '50200'] as const

// Standard-Tagessatz, wenn weder manuell gesetzt noch aus Mite ableitbar.
export const STANDARD_DAY_RATE = 2000

// ── Projekt-Auswertung ─────────────────────────────────────────────────────

export type Health = 'over' | 'tight' | 'ok' | 'none'

export interface ProjectStat {
  project: Project
  bookedDays: number
  bookedToDateDays: number
  actualDays: number // aus actuals (Ist), 0 solange keine Zeiterfassung
  // ── Controlling-Dreieck: Budget / Plan / Ist (in Tagen) ──
  istMiteDays: number // Ist (getrackt aus Mite), Minuten/60/8
  istMiteHours: number
  istMiteEur: number | null
  hasMite: boolean // gibt es Mite-Ist für dieses Projekt?
  // Plan (geplante Tage) = bookedDays (Summe bookings). hasPlan = bookedDays > 0.
  dayRateEur: number | null // effektiver Tagessatz (manuell > Mite > Standard 2.000)
  rateSource: 'manuell' | 'mite' | 'standard' | null
  budgetDaysEff: number | null // Budget € / effektiver Tagessatz = verfügbare Tage
  budgetConsumedPct: number | null // Ist-€ / Budget-€
  deltaIstBudgetDays: number | null // Budget(T) − Ist(T): Budget-Rest
  deltaPlanBudgetDays: number | null // Budget(T) − Plan(T): noch verplanbar
  deltaIstPlanDays: number | null // Ist(T) − Plan(T): Erfassung vs. Plan
  rateBreakdown: { rate: number; hours: number }[] // definierte Mite-Sätze × Stunden (Tooltip)
  productLabel: string | null // Leistungskategorie (dominantes Produkt seiner Meilensteine)
  productKtr: string | null // KTR-Nummer der Kategorie (z. B. 50100)
  budgetDays: number | null
  diffDays: number | null
  budgetPct: number | null // gebucht / Budget
  health: Health
  forecast: string // kurze Prognose/Status-Phrase
  budgetEur: number | null
  invoicedEur: number // gestellt + bezahlt
  paidEur: number
  openEur: number // budget_eur − fakturiert (falls budget bekannt)
  rangeStart: string | null
  rangeEnd: string | null
  employeeNames: string[]
}

/** Gebuchte Tage je Buchung = Arbeitstage (ohne Feiertage) × Tagessatz (budget). */
function bookingDays(b: Booking, untilISO?: string): number {
  const end = untilISO && b.end_date > untilISO ? untilISO : b.end_date
  if (b.start_date > end) return 0
  return workdaysNoHolidays(b.start_date, end) * Number(b.budget)
}

function healthOf(booked: number, budget: number | null): Health {
  if (budget == null || budget === 0) return 'none'
  const r = booked / budget
  if (r > 1.0) return 'over'
  if (r >= 0.9) return 'tight'
  return 'ok'
}

/** Aggregiert produktive (Nicht-System-)Projekte. */
export function projectStats(data: AnalyticsData): ProjectStat[] {
  const empName = new Map(data.employees.map((e) => [e.id, e.name]))
  const bookingProject = new Map(data.bookings.map((b) => [b.id, b.project_id]))
  const today = todayISO()

  // Ist-Stunden je Projekt aus actuals (über booking_id → project_id).
  const actualHByProject = new Map<string, number>()
  for (const a of data.actuals) {
    const pid = a.booking_id ? bookingProject.get(a.booking_id) : undefined
    if (!pid) continue
    actualHByProject.set(pid, (actualHByProject.get(pid) ?? 0) + Number(a.hours))
  }

  // Ist aus Mite (project_actuals): Minuten + Umsatz je Projekt.
  // billableMinutes = nur Zeilen mit revenue > 0 (für den Tagessatz; 0€-Services
  // wie Reise/intern würden den Satz sonst verwässern).
  const miteByProject = new Map<string, { minutes: number; revenue: number; billableMinutes: number }>()
  // Definierte Sätze je Projekt: Satz (€/Tag, aus revenue/min rekonstruiert) → Minuten.
  const ratesByProject = new Map<string, Map<number, number>>()
  for (const pa of data.projectActuals) {
    const cur = miteByProject.get(pa.project_id) ?? { minutes: 0, revenue: 0, billableMinutes: 0 }
    const min = Number(pa.minutes ?? 0)
    const rev = Number(pa.revenue_eur ?? 0)
    cur.minutes += min
    cur.revenue += rev
    if (rev > 0) {
      cur.billableMinutes += min
      if (min > 0) {
        const rate = Math.round((rev * 480) / min) // €/Tag des Services
        const rm = ratesByProject.get(pa.project_id) ?? new Map<number, number>()
        rm.set(rate, (rm.get(rate) ?? 0) + min)
        ratesByProject.set(pa.project_id, rm)
      }
    }
    miteByProject.set(pa.project_id, cur)
  }

  // Dominantes Produkt je Projekt (häufigste Leistungskategorie seiner Meilensteine).
  const productCount = new Map<string, Map<string, number>>()
  for (const m of data.milestones) {
    if (!m.product) continue
    const pm = productCount.get(m.project_id) ?? new Map<string, number>()
    pm.set(m.product, (pm.get(m.product) ?? 0) + 1)
    productCount.set(m.project_id, pm)
  }
  const dominantProduct = (projectId: string): string | null => {
    const pm = productCount.get(projectId)
    if (!pm) return null
    return [...pm.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  const projects = data.projects.filter((p) => !p.is_system)

  return projects.map((project) => {
    const tasks = data.bookings.filter((b) => b.project_id === project.id)
    const bookedDays = tasks.reduce((s, b) => s + bookingDays(b), 0)
    const bookedToDateDays = tasks.reduce((s, b) => s + bookingDays(b, today), 0)
    const budgetDays = project.budget_days
    const diffDays = budgetDays != null ? budgetDays - bookedDays : null
    const budgetPct =
      budgetDays != null && budgetDays > 0 ? Math.round((bookedDays / budgetDays) * 100) : null
    const health = healthOf(bookedDays, budgetDays)

    // Fakturastand aus Meilensteinen.
    let invoicedEur = 0
    let paidEur = 0
    for (const m of data.milestones) {
      if (m.project_id !== project.id || m.amount_eur == null) continue
      if (m.invoice_status === 'bezahlt') {
        paidEur += Number(m.amount_eur)
        invoicedEur += Number(m.amount_eur)
      } else if (m.invoice_status === 'gestellt') {
        invoicedEur += Number(m.amount_eur)
      }
    }
    const budgetEur = project.budget_eur
    const openEur = budgetEur != null ? Math.max(0, budgetEur - invoicedEur) : 0

    let rangeStart: string | null = null
    let rangeEnd: string | null = null
    for (const b of tasks) {
      if (rangeStart === null || b.start_date < rangeStart) rangeStart = b.start_date
      if (rangeEnd === null || b.end_date > rangeEnd) rangeEnd = b.end_date
    }

    // Prognose/Status-Phrase.
    let forecast = '–'
    if (project.status === 'abgeschlossen') forecast = 'abgeschlossen'
    else if (project.end_date && project.end_date < today) forecast = 'überfällig'
    else if (health === 'over') forecast = `${Math.abs(diffDays ?? 0)} T über Budget`
    else if (health === 'tight') forecast = 'Budget fast erschöpft'
    else if (health === 'ok') forecast = 'im Plan'

    const employeeNames = [...new Set(tasks.map((b) => b.employee_id))]
      .map((id) => empName.get(id) ?? '?')
      .sort()

    // ── Ist (getrackt aus Mite) ──
    const mite = miteByProject.get(project.id)
    const istMiteMinutes = mite?.minutes ?? 0
    const istMiteHours = istMiteMinutes / 60
    const istMiteDays = istMiteHours / HOURS_PER_DAY
    const hasMite = istMiteMinutes > 0
    const budgetConsumedPct =
      hasMite && budgetEur != null && budgetEur > 0
        ? Math.round((mite!.revenue / budgetEur) * 100)
        : null

    // ── Effektiver Tagessatz: manuell > Mite-Ist > Standard 2.000 ──
    const billableHours = (mite?.billableMinutes ?? 0) / 60
    const dayRateMite =
      hasMite && billableHours > 0 ? Math.round((mite!.revenue / billableHours) * 8) : null
    const manualRate = project.day_rate_eur != null ? Number(project.day_rate_eur) : null
    const dayRateEur = manualRate ?? dayRateMite ?? STANDARD_DAY_RATE
    const rateSource: ProjectStat['rateSource'] =
      manualRate != null ? 'manuell' : dayRateMite != null ? 'mite' : 'standard'

    // ── Budget in Tagen + die drei Deltas ──
    const budgetDaysEff = budgetEur != null && dayRateEur > 0 ? round1(budgetEur / dayRateEur) : null
    const hasPlan = bookedDays > 0
    const deltaIstBudgetDays =
      budgetDaysEff != null && hasMite ? round1(budgetDaysEff - istMiteDays) : null
    const deltaPlanBudgetDays =
      budgetDaysEff != null && hasPlan ? round1(budgetDaysEff - bookedDays) : null
    const deltaIstPlanDays = hasMite && hasPlan ? round1(istMiteDays - bookedDays) : null

    const rateBreakdown = [...(ratesByProject.get(project.id) ?? new Map<number, number>())]
      .map(([rate, min]) => ({ rate, hours: round1(min / 60) }))
      .sort((a, b) => b.hours - a.hours)
    const cat = parseProduct(dominantProduct(project.id))

    return {
      project,
      bookedDays: round1(bookedDays),
      bookedToDateDays: round1(bookedToDateDays),
      actualDays: round1((actualHByProject.get(project.id) ?? 0) / HOURS_PER_DAY),
      istMiteDays: round1(istMiteDays),
      istMiteHours: round1(istMiteHours),
      istMiteEur: hasMite ? Math.round(mite!.revenue) : null,
      hasMite,
      dayRateEur,
      rateSource,
      budgetDaysEff,
      budgetConsumedPct,
      deltaIstBudgetDays,
      deltaPlanBudgetDays,
      deltaIstPlanDays,
      rateBreakdown,
      productLabel: cat?.label ?? null,
      productKtr: cat?.ktr ?? null,
      budgetDays,
      diffDays: diffDays != null ? round1(diffDays) : null,
      budgetPct,
      health,
      forecast,
      budgetEur,
      invoicedEur: Math.round(invoicedEur),
      paidEur: Math.round(paidEur),
      openEur: Math.round(openEur),
      rangeStart,
      rangeEnd,
      employeeNames,
    }
  })
}

// ── Projekt-KPIs (Dashboard-Leiste über der Tabelle) ───────────────────────

export interface ProjectKpis {
  year: number
  count: number // produktive Projekte mit Aktivität im laufenden Jahr
  plannedDaysYear: number // verplante Tage im laufenden Jahr (alle Mitarbeiter)
  overBudget: number // Plan > Budget(T)
  underBudget: number // Plan ≤ Budget(T)
  withBudget: number // Projekte mit definiertem Budget
  overdue: number // end_date < heute, nicht abgeschlossen
  mitePct: number // % der Jahres-Projekte mit Mite-Ist
  budgetEurYear: number // Summe Budget € der Jahres-Projekte
  openEur: number // Summe offener Faktura €
}

/** Kennzahlen über die produktiven Projekte des laufenden Kalenderjahres. */
export function projectKpis(data: AnalyticsData, stats: ProjectStat[], today = new Date()): ProjectKpis {
  const year = today.getFullYear()
  const yStart = `${year}-01-01`
  const yEnd = `${year}-12-31`
  const tIso = todayISO()
  const projById = new Map(data.projects.map((p) => [p.id, p]))

  // Verplante Tage je Projekt im laufenden Jahr (Buchungen auf das Jahr beschnitten).
  const plannedByProj = new Map<string, number>()
  let plannedDaysYear = 0
  for (const b of data.bookings) {
    const p = projById.get(b.project_id)
    if (!p || p.is_system) continue
    const s = b.start_date < yStart ? yStart : b.start_date
    const e = b.end_date > yEnd ? yEnd : b.end_date
    if (s > e) continue
    const d = workdaysNoHolidays(s, e) * Number(b.budget)
    plannedByProj.set(b.project_id, (plannedByProj.get(b.project_id) ?? 0) + d)
    plannedDaysYear += d
  }

  // Projekte mit Aktivität im Jahr: verplante Tage > 0 ODER Meilenstein fällig im Jahr.
  const statByProj = new Map(stats.map((s) => [s.project.id, s]))
  const activeIds = new Set<string>()
  for (const [id, d] of plannedByProj) if (d > 0) activeIds.add(id)
  for (const m of data.milestones) {
    if (m.due_date && m.due_date >= yStart && m.due_date <= yEnd && statByProj.has(m.project_id))
      activeIds.add(m.project_id)
  }

  let overBudget = 0
  let underBudget = 0
  let withBudget = 0
  let overdue = 0
  let miteCount = 0
  let budgetEurYear = 0
  let openEur = 0
  for (const id of activeIds) {
    const st = statByProj.get(id)
    if (!st) continue
    if (st.hasMite) miteCount++
    if (st.budgetEur != null) budgetEurYear += st.budgetEur
    openEur += st.openEur
    if (st.project.end_date && st.project.end_date < tIso && st.project.status !== 'abgeschlossen') overdue++
    if (st.budgetDaysEff != null) {
      withBudget++
      if (st.bookedDays > st.budgetDaysEff) overBudget++
      else underBudget++
    }
  }

  return {
    year,
    count: activeIds.size,
    plannedDaysYear: round1(plannedDaysYear),
    overBudget,
    underBudget,
    withBudget,
    overdue,
    mitePct: activeIds.size ? Math.round((miteCount / activeIds.size) * 100) : 0,
    budgetEurYear: Math.round(budgetEurYear),
    openEur: Math.round(openEur),
  }
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

/** Alle 12 Monate eines Kalenderjahres. */
export function yearWindow(year: number): MonthWindow[] {
  return MONTH_ABBR.map((label, month) => ({ year, month, label }))
}

export interface MonthStat {
  year: number
  month: number
  label: string
  pct: number // produktive Auslastung in %
  bookedDays: number // produktive Tage
  netAvailDays: number // verfügbare FTE-Tage (Kapazität − Abwesenheit)
  absenceDays: number
  adminDays: number
  projectNames: string[]
}

/**
 * Monats-Auslastung eines Mitarbeiters – tagesgenau (FTE-Basis), damit
 * unterjährig wechselnde Wochenstunden korrekt zählen.
 */
function statForMonth(emp: Employee, data: AnalyticsData, m: MonthWindow): MonthStat {
  const projById = new Map(data.projects.map((p) => [p.id, p]))
  const firstDay = new Date(m.year, m.month, 1)
  const lastDay = new Date(m.year, m.month + 1, 0)
  const monthStart = toISODate(firstDay)
  const monthEnd = toISODate(lastDay)

  const monthBookings = data.bookings.filter(
    (b) => b.employee_id === emp.id && b.end_date >= monthStart && b.start_date <= monthEnd,
  )

  let availDaysFTE = 0
  let bookedDays = 0
  let absenceDays = 0
  let adminDays = 0
  const projSet = new Set<string>()

  const cur = new Date(firstDay)
  while (cur <= lastDay) {
    const dow = cur.getDay()
    const iso = toISODate(cur)
    if (dow >= 1 && dow <= 5 && !holidayName(iso)) {
      availDaysFTE += weeklyHoursForDate(emp, data.hoursPeriods, iso) / 40
      for (const b of monthBookings) {
        if (b.start_date > iso || b.end_date < iso) continue
        const p = projById.get(b.project_id)
        const share = Number(b.budget)
        if (isAbsence(p)) absenceDays += share
        else if (p && p.is_system) adminDays += share
        else {
          bookedDays += share
          if (p) projSet.add(p.name)
        }
      }
    }
    cur.setDate(cur.getDate() + 1)
  }

  const netAvailDays = Math.max(0, availDaysFTE - absenceDays)
  const pct = netAvailDays > 0 ? Math.round((bookedDays / netAvailDays) * 100) : 0

  return {
    year: m.year,
    month: m.month,
    label: m.label,
    pct,
    bookedDays: round1(bookedDays),
    netAvailDays: round1(netAvailDays),
    absenceDays: round1(absenceDays),
    adminDays: round1(adminDays),
    projectNames: [...projSet].sort(),
  }
}

export function employeeMonthStats(emp: Employee, data: AnalyticsData, months: MonthWindow[]): MonthStat[] {
  return months.map((m) => statForMonth(emp, data, m))
}

/** Zusammenfassung über mehrere Monate (für die Σ-Spalte). */
export function summarize(stats: MonthStat[]): { pct: number; bookedDays: number; netAvailDays: number } {
  const bookedDays = stats.reduce((s, m) => s + m.bookedDays, 0)
  const netAvailDays = stats.reduce((s, m) => s + m.netAvailDays, 0)
  return {
    pct: netAvailDays > 0 ? Math.round((bookedDays / netAvailDays) * 100) : 0,
    bookedDays: round1(bookedDays),
    netAvailDays: round1(netAvailDays),
  }
}

export interface TeamKpis {
  monthLabel: string
  avgPct: number
  overloaded: number // Mitarbeiter mit > 100 %
  underloaded: number // Mitarbeiter mit < 70 %
  freeDays: number // freie Kapazität in PT
}

/** Team-Kennzahlen für den aktuellen Kalendermonat. */
export function teamKpis(data: AnalyticsData, today = new Date()): TeamKpis {
  const m = monthWindow(today, 0, 0)[0]
  const stats = data.employees.map((e) => statForMonth(e, data, m))
  const withCap = stats.filter((s) => s.netAvailDays > 0)
  const avgPct = withCap.length
    ? Math.round(withCap.reduce((s, x) => s + x.pct, 0) / withCap.length)
    : 0
  const freeDays = stats.reduce((s, x) => s + Math.max(0, x.netAvailDays - x.bookedDays), 0)
  return {
    monthLabel: m.label,
    avgPct,
    overloaded: stats.filter((s) => s.pct > 100).length,
    underloaded: withCap.filter((s) => s.pct < 70).length,
    freeDays: round1(freeDays),
  }
}

export interface DetailRow {
  name: string
  color: string | null
  days: number
  kind: 'project' | 'absence' | 'admin'
}

/** Aufschlüsselung eines Mitarbeiter-Monats nach Projekten/Kategorien (Drilldown). */
export function monthDetail(emp: Employee, data: AnalyticsData, year: number, month: number): DetailRow[] {
  const projById = new Map(data.projects.map((p) => [p.id, p]))
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const monthStart = toISODate(firstDay)
  const monthEnd = toISODate(lastDay)

  const acc = new Map<string, DetailRow>()
  const monthBookings = data.bookings.filter(
    (b) => b.employee_id === emp.id && b.end_date >= monthStart && b.start_date <= monthEnd,
  )

  const cur = new Date(firstDay)
  while (cur <= lastDay) {
    const dow = cur.getDay()
    const iso = toISODate(cur)
    if (dow >= 1 && dow <= 5 && !holidayName(iso)) {
      for (const b of monthBookings) {
        if (b.start_date > iso || b.end_date < iso) continue
        const p = projById.get(b.project_id)
        const name = p?.name ?? '—'
        const kind: DetailRow['kind'] = isAbsence(p) ? 'absence' : p?.is_system ? 'admin' : 'project'
        const row = acc.get(name) ?? { name, color: p?.color ?? null, days: 0, kind }
        row.days += Number(b.budget)
        acc.set(name, row)
      }
    }
    cur.setDate(cur.getDate() + 1)
  }

  return [...acc.values()]
    .map((r) => ({ ...r, days: round1(r.days) }))
    .sort((a, b) => b.days - a.days)
}
