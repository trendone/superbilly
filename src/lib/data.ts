import { supabase } from './supabase'
import type { Database } from './database.types'
import { toISODate, workingDaysBetween } from './dates'

export type Employee = Database['public']['Tables']['employees']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Department = Database['public']['Tables']['departments']['Row']

export interface WeekData {
  employees: Employee[]
  projects: Project[]
  bookings: Booking[]
  departments: Department[]
}

/** Lädt Mitarbeiter, Projekte und alle Buchungen, die die Woche [mo..fr] berühren. */
export async function fetchWeek(mondayISO: string, fridayISO: string): Promise<WeekData> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')

  const [emp, proj, book, dep] = await Promise.all([
    supabase.from('employees').select('*').eq('active', true).eq('bookable', true).order('name'),
    supabase.from('projects').select('*'),
    supabase
      .from('bookings')
      .select('*')
      .lte('start_date', fridayISO)
      .gte('end_date', mondayISO),
    supabase.from('departments').select('*').order('sort_order').order('name'),
  ])

  if (emp.error) throw emp.error
  if (proj.error) throw proj.error
  if (book.error) throw book.error
  if (dep.error) throw dep.error

  return { employees: emp.data, projects: proj.data, bookings: book.data, departments: dep.data }
}

/** Felder einer manuellen Planungs-Buchung (Anlegen/Bearbeiten). */
export interface BookingInput {
  employee_id: string
  project_id: string
  start_date: string
  end_date: string
  budget: number
  note: string | null
  is_workshop: boolean
}

export async function createBooking(input: BookingInput): Promise<Booking> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('bookings')
    .insert({ ...input, source: 'manuell' })
    .select('*')
    .single()
  if (error) throw error
  // Erste Buchung auf ein Projekt beendet dessen "neu"-Kennzeichnung (Pipeline-Bereich).
  await supabase.from('projects').update({ is_new: false }).eq('id', input.project_id).eq('is_new', true)
  return data
}

export async function updateBooking(id: string, input: BookingInput): Promise<Booking> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('bookings')
    .update(input)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Volle Buchungs-Zeilen der angegebenen Projekte, die den Zeitraum [from..to]
 * berühren. Für die projekt-gebundene Schnellplanung: das Projekt ist fix, es
 * werden nur die Buchungen des sichtbaren Wochenfensters geladen (inkl. id, damit
 * einzelne Kacheln direkt entfernt werden können).
 */
export async function fetchProjectRangeBookings(
  projectIds: string[],
  fromISO: string,
  toISO: string,
): Promise<Booking[]> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .in('project_id', projectIds)
    .lte('start_date', toISO)
    .gte('end_date', fromISO)
    .order('start_date')
  if (error) throw error
  return data
}

/**
 * Alle Buchungen der angegebenen Mitarbeitenden, die den Zeitraum [from..to]
 * berühren – projektübergreifend. Für die Schnellplanung, um die bereits
 * bestehende Belegung (andere Projekte, Abwesenheit) sichtbar zu machen.
 */
export async function fetchEmployeesRangeBookings(
  employeeIds: string[],
  fromISO: string,
  toISO: string,
): Promise<Booking[]> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  if (employeeIds.length === 0) return []
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .in('employee_id', employeeIds)
    .lte('start_date', toISO)
    .gte('end_date', fromISO)
  if (error) throw error
  return data
}

/** Reduzierte Projekt-Metadaten zum Klassifizieren/Beschriften fremder Buchungen. */
export interface ProjectMeta {
  id: string
  name: string
  color: string | null
  is_system: boolean
  status: string
}

export async function fetchProjectMeta(): Promise<ProjectMeta[]> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, color, is_system, status')
  if (error) throw error
  return data
}

export async function deleteBooking(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { error } = await supabase.from('bookings').delete().eq('id', id)
  if (error) throw error
}

/**
 * Tageslast eines Mitarbeiters im Zeitraum [start..end]: je Tag die Summe der
 * Arbeits- bzw. Abwesenheits-Budgets aus bestehenden Buchungen. Dient der
 * Tages-Überbuchungs-Prüfung im Buchungs-Modal.
 */
export async function employeeDayLoads(
  employeeId: string,
  startISO: string,
  endISO: string,
  absenceProjectIds: Set<string>,
  excludeId?: string,
  reservedProjectIds?: Set<string>,
): Promise<Record<string, { work: number; absence: number }>> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('bookings')
    .select('id,start_date,end_date,budget,project_id')
    .eq('employee_id', employeeId)
    .lte('start_date', endISO)
    .gte('end_date', startISO)
  if (error) throw error

  const loads: Record<string, { work: number; absence: number }> = {}
  for (const b of data) {
    if (b.id === excludeId) continue
    // Vorgemerkte (reservierte) Buchungen zählen nicht in die Tageslast.
    if (reservedProjectIds?.has(b.project_id)) continue
    const isAbs = absenceProjectIds.has(b.project_id)
    const d = new Date(`${b.start_date}T00:00:00`)
    const last = new Date(`${b.end_date}T00:00:00`)
    while (d <= last) {
      const wd = d.getDay()
      const iso = toISODate(d)
      if (wd !== 0 && wd !== 6 && iso >= startISO && iso <= endISO) {
        const cur = loads[iso] ?? { work: 0, absence: 0 }
        if (isAbs) cur.absence += Number(b.budget)
        else cur.work += Number(b.budget)
        loads[iso] = cur
      }
      d.setDate(d.getDate() + 1)
    }
  }
  return loads
}

/** Summe verplanter Arbeitstage eines Projekts (alle Buchungen, optional eine ausgenommen). */
export async function projectBookedDays(projectId: string, excludeId?: string): Promise<number> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('bookings')
    .select('id,start_date,end_date,budget')
    .eq('project_id', projectId)
  if (error) throw error
  let total = 0
  for (const b of data) {
    if (b.id === excludeId) continue
    total += workingDaysBetween(b.start_date, b.end_date) * Number(b.budget)
  }
  return Math.round(total * 10) / 10
}
