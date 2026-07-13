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

/** Aggregierte Mite-Ist-Zeiten (aus project_actuals) für dieses Projekt. */
export interface ProjectMite {
  minutes: number // getrackte Gesamtzeit
  revenue: number // getrackter Umsatz (nur Zeilen mit revenue > 0)
  billableMinutes: number // Minuten der abrechenbaren Zeilen (für den Tagessatz)
}

export interface ProjectDetail {
  project: Project
  /** Verknüpftes Zoho-Projekt (source='zoho'), falls dieses Projekt manuell damit
   *  zusammengeführt wurde. Meilensteine/Buchungen/Budget sind bereits gemerged. */
  linkedProject: Project | null
  milestones: Milestone[]
  bookings: ProjectBooking[]
  employees: { id: string; name: string }[]
  /** Ist-Zeiten aus Mite über beide Projekt-IDs (interne + verknüpfte Zoho-Zeile). */
  mite: ProjectMite
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

/** Reduziertes verknüpftes Zoho-Projekt für Listen-/Kartenanzeige. */
export interface LinkedProjectRef {
  id: string
  name: string
  offer_number: string | null
  budget_eur: number | null
  status: string
}

/** Projekt + abgeleitete Filter-Merkmale für die Projektliste. */
export interface ProjectRow extends Project {
  employeeIds: string[] // Mitarbeitende mit Buchung auf diesem Projekt
  categoryLabel: string | null // dominante Leistungskategorie (z. B. „Fokus Keynotes")
  categoryKtr: string | null
  hasBookings: boolean // mind. eine Planungsbuchung vorhanden ("noch zu verplanen", wenn false)
  linkedProject: LinkedProjectRef | null // manuell zusammengeführtes Zoho-Projekt (Karte davon ausgeblendet)
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

  // Manuelle Zusammenführung: internes Projekt „beansprucht" ein Zoho-Projekt.
  // Die beanspruchten Zoho-Karten werden ausgeblendet (nur noch eine Karte je
  // realem Projekt); ihr Budget/ihre Kategorie erscheint am internen Projekt.
  const byId = new Map(proj.data.map((p) => [p.id, p]))
  const linkedTargetIds = new Set(
    proj.data.map((p) => p.linked_project_id).filter((v): v is string => !!v),
  )

  const projects: ProjectRow[] = proj.data
    .filter((p) => !linkedTargetIds.has(p.id))
    .map((p) => {
      const linked = p.linked_project_id ? byId.get(p.linked_project_id) ?? null : null

      // Kategorie aus eigenen + (bei Verknüpfung) den Zoho-Meilensteinen ableiten.
      const merged = new Map<string, number>()
      for (const src of [p.id, linked?.id]) {
        if (!src) continue
        for (const [prod, n] of prodCount.get(src) ?? []) merged.set(prod, (merged.get(prod) ?? 0) + n)
      }
      const dom = merged.size ? [...merged.entries()].sort((a, b) => b[1] - a[1])[0][0] : null
      const cat = parseProduct(dom)

      return {
        ...p,
        // Budget des Zoho-Deals einblenden, falls das interne Projekt keines hat.
        budget_eur: p.budget_eur ?? linked?.budget_eur ?? null,
        employeeIds: [...(empByProject.get(p.id) ?? [])],
        categoryLabel: cat?.label ?? null,
        categoryKtr: cat?.ktr ?? null,
        hasBookings: bookedProjectIds.has(p.id),
        linkedProject: linked
          ? {
              id: linked.id,
              name: linked.name,
              offer_number: linked.offer_number,
              budget_eur: linked.budget_eur,
              status: linked.status,
            }
          : null,
      }
    })

  return { projects, employees: emp.data }
}

/** Ein Projekt mit Meilensteinen, Buchungen und Mitarbeiter-Namen. Bei einer
 *  manuellen Zoho-Verknüpfung werden Meilensteine und Buchungen des verknüpften
 *  Zoho-Projekts mit eingemischt (Zusammenführungs-Ansicht). */
export async function fetchProjectDetail(projectId: string): Promise<ProjectDetail> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const proj = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (proj.error) throw proj.error
  const project = proj.data

  let linkedProject: Project | null = null
  if (project.linked_project_id) {
    const lp = await supabase.from('projects').select('*').eq('id', project.linked_project_id).single()
    if (!lp.error) linkedProject = lp.data
  }

  // Meilensteine/Buchungen über beide Projekt-IDs (interne + verknüpfte Zoho-Zeile).
  const ids = linkedProject ? [projectId, linkedProject.id] : [projectId]
  const [ms, book, emp, act] = await Promise.all([
    supabase
      .from('milestones')
      .select('*')
      .in('project_id', ids)
      .order('due_date', { nullsFirst: false }),
    supabase
      .from('bookings')
      .select('employee_id, start_date, end_date, budget')
      .in('project_id', ids),
    supabase.from('employees').select('id, name').order('name'),
    supabase.from('project_actuals').select('minutes, revenue_eur').in('project_id', ids),
  ])
  if (ms.error) throw ms.error
  if (book.error) throw book.error
  if (emp.error) throw emp.error
  if (act.error) throw act.error

  // Mite-Ist über beide Projekt-IDs summieren (analog zu analytics.ts/projectStats).
  const mite = (act.data ?? []).reduce<ProjectMite>(
    (m, r) => {
      const min = Number(r.minutes ?? 0)
      const rev = Number(r.revenue_eur ?? 0)
      m.minutes += min
      if (rev > 0) {
        m.revenue += rev
        m.billableMinutes += min
      }
      return m
    },
    { minutes: 0, revenue: 0, billableMinutes: 0 },
  )

  return {
    project,
    linkedProject,
    milestones: ms.data,
    bookings: book.data as ProjectBooking[],
    employees: emp.data,
    mite,
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

// ── Manuelle Zoho-Verknüpfung (nur Admin, Gating im Frontend) ────────────────

/** Verknüpfbares Zoho-Projekt für die Auswahl beim Zusammenführen. */
export interface LinkableProject {
  id: string
  name: string
  client: string | null
  status: string
  budget_eur: number | null
  offer_number: string | null
}

/**
 * Kandidaten zum Verknüpfen: gespiegelte Zoho-Projekte, die weder verloren noch
 * bereits von einem anderen Projekt beansprucht sind. `excludeId` blendet das
 * eigene Projekt aus (ein Projekt kann sich nicht mit sich selbst verknüpfen).
 */
export async function fetchLinkableZohoProjects(excludeId?: string): Promise<LinkableProject[]> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const [zoho, linked] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, client, status, budget_eur, offer_number')
      .eq('source', 'zoho')
      .eq('is_system', false)
      .neq('status', 'verloren')
      .order('name'),
    supabase.from('projects').select('linked_project_id').not('linked_project_id', 'is', null),
  ])
  if (zoho.error) throw zoho.error
  if (linked.error) throw linked.error
  const claimed = new Set(linked.data.map((r) => r.linked_project_id as string))
  return zoho.data.filter((p) => p.id !== excludeId && !claimed.has(p.id))
}

/** Verknüpft ein Nicht-Zoho-Projekt mit einem Zoho-Projekt (Zusammenführung). */
export async function linkProject(projectId: string, zohoProjectId: string): Promise<Project> {
  return updateProject(projectId, { linked_project_id: zohoProjectId })
}

/** Hebt eine bestehende Zoho-Verknüpfung wieder auf. */
export async function unlinkProject(projectId: string): Promise<Project> {
  return updateProject(projectId, { linked_project_id: null })
}
