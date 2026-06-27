import { supabase } from './supabase'
import type { Database } from './database.types'
import type { Milestone } from './milestones'

export type Project = Database['public']['Tables']['projects']['Row']
export type ProjectUpdate = Database['public']['Tables']['projects']['Update']

export const PROJECT_STATES = ['akquise', 'aktiv', 'pausiert', 'abgeschlossen'] as const

/** Buchung in reduzierter Form für die Ressourcen-Aggregation. */
export interface ProjectBooking {
  employee_id: string
  start_date: string
  end_date: string
  budget: number
}

export interface ProjectDetail {
  project: Project
  milestones: Milestone[]
  bookings: ProjectBooking[]
  employees: { id: string; name: string }[]
}

/** Alle echten (Nicht-System-)Projekte. */
export async function fetchProjects(): Promise<Project[]> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('is_system', false)
    .order('name')
  if (error) throw error
  return data
}

/** Ein Projekt mit Meilensteinen, Buchungen und Mitarbeiter-Namen. */
export async function fetchProjectDetail(projectId: string): Promise<ProjectDetail> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const [proj, ms, book, emp] = await Promise.all([
    supabase.from('projects').select('*').eq('id', projectId).single(),
    supabase
      .from('milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('due_date', { nullsFirst: false }),
    supabase
      .from('bookings')
      .select('employee_id, start_date, end_date, budget')
      .eq('project_id', projectId),
    supabase.from('employees').select('id, name').order('name'),
  ])
  if (proj.error) throw proj.error
  if (ms.error) throw ms.error
  if (book.error) throw book.error
  if (emp.error) throw emp.error
  return {
    project: proj.data,
    milestones: ms.data,
    bookings: book.data as ProjectBooking[],
    employees: emp.data,
  }
}

export async function updateProject(id: string, patch: ProjectUpdate): Promise<Project> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
