import { supabase } from './supabase'
import type { Database } from './database.types'
import type { Milestone } from './milestones'
import { fetchAll, parseProduct } from './analytics'

export type Project = Database['public']['Tables']['projects']['Row']
export type ProjectUpdate = Database['public']['Tables']['projects']['Update']
export type ProjectInsert = Database['public']['Tables']['projects']['Insert']

// Reservierungs-Helfer (Single Source of Truth in analytics.ts) hier re-exportiert,
// damit UI-/Datenmodule sie aus der Projekt-Schicht beziehen können.
export { RESERVED_STATES, isReservedStatus, isReservedProject, isLostProject } from './analytics'

export const PROJECT_STATES = [
  'akquise', 'aktiv', 'pausiert', 'abgeschlossen', 'angebot', 'verhandlung', 'verloren',
] as const

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
    .neq('status', 'verloren')
    .order('name')
  if (error) throw error
  return data
}

/** Projekt + abgeleitete Filter-Merkmale für die Projektliste. */
export interface ProjectRow extends Project {
  employeeIds: string[] // Mitarbeitende mit Buchung auf diesem Projekt
  categoryLabel: string | null // dominante Leistungskategorie (z. B. „Fokus Keynotes")
  categoryKtr: string | null
  hasBookings: boolean // mind. eine Planungsbuchung vorhanden ("noch zu verplanen", wenn false)
}

export interface ProjectsView {
  projects: ProjectRow[]
  employees: { id: string; name: string }[]
}

/**
 * Alle echten Projekte samt der Merkmale, nach denen in der Liste gefiltert
 * wird: gebuchte Mitarbeitende (aus bookings) und die dominante
 * Leistungskategorie (aus den Produkten der Meilensteine – wie in der Auswertung).
 */
export async function fetchProjectsView(): Promise<ProjectsView> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const [proj, book, ms, emp] = await Promise.all([
    supabase.from('projects').select('*').eq('is_system', false).neq('status', 'verloren').order('name'),
    fetchAll<{ project_id: string; employee_id: string | null }>('bookings', 'project_id, employee_id'),
    supabase.from('milestones').select('project_id, product'),
    supabase.from('employees').select('id, name').order('name'),
  ])
  if (proj.error) throw proj.error
  if (ms.error) throw ms.error
  if (emp.error) throw emp.error

  const empByProject = new Map<string, Set<string>>()
  const bookedProjectIds = new Set<string>()
  for (const b of book) {
    bookedProjectIds.add(b.project_id)
    if (!b.employee_id) continue
    const set = empByProject.get(b.project_id) ?? new Set<string>()
    set.add(b.employee_id)
    empByProject.set(b.project_id, set)
  }

  // Häufigstes Produkt je Projekt → Leistungskategorie.
  const prodCount = new Map<string, Map<string, number>>()
  for (const m of ms.data) {
    if (!m.product) continue
    const pm = prodCount.get(m.project_id) ?? new Map<string, number>()
    pm.set(m.product, (pm.get(m.product) ?? 0) + 1)
    prodCount.set(m.project_id, pm)
  }

  const projects: ProjectRow[] = proj.data.map((p) => {
    const pm = prodCount.get(p.id)
    const dom = pm ? [...pm.entries()].sort((a, b) => b[1] - a[1])[0][0] : null
    const cat = parseProduct(dom)
    return {
      ...p,
      employeeIds: [...(empByProject.get(p.id) ?? [])],
      categoryLabel: cat?.label ?? null,
      categoryKtr: cat?.ktr ?? null,
      hasBookings: bookedProjectIds.has(p.id),
    }
  })

  return { projects, employees: emp.data }
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

/**
 * Legt ein Projekt händisch an. Gedacht als Fallback für interne Projekte –
 * Kundenprojekte kommen über den Zoho-Sync. Daher fix `source: 'intern'` und
 * kein `external_id`, damit es sauber von gespiegelten Projekten getrennt bleibt.
 */
export async function createProject(input: ProjectInsert): Promise<Project> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...input, source: 'intern', is_system: false })
    .select()
    .single()
  if (error) throw error
  return data
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

/** Löscht ein Projekt samt Buchungen/Meilensteinen (on delete cascade). Nur für Nicht-Zoho-Projekte gedacht. */
export async function deleteProject(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}
