import { supabase } from './supabase'
import type { Database } from './database.types'

export type Employee = Database['public']['Tables']['employees']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']

export interface WeekData {
  employees: Employee[]
  projects: Project[]
  bookings: Booking[]
}

/** Lädt Mitarbeiter, Projekte und alle Buchungen, die die Woche [mo..fr] berühren. */
export async function fetchWeek(mondayISO: string, fridayISO: string): Promise<WeekData> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')

  const [emp, proj, book] = await Promise.all([
    supabase.from('employees').select('*').eq('active', true).order('name'),
    supabase.from('projects').select('*'),
    supabase
      .from('bookings')
      .select('*')
      .lte('start_date', fridayISO)
      .gte('end_date', mondayISO),
  ])

  if (emp.error) throw emp.error
  if (proj.error) throw proj.error
  if (book.error) throw book.error

  return { employees: emp.data, projects: proj.data, bookings: book.data }
}
