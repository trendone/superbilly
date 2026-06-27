import { supabase } from './supabase'
import type { Database } from './database.types'

export type Milestone = Database['public']['Tables']['milestones']['Row']
export type MilestoneInsert = Database['public']['Tables']['milestones']['Insert']
export type MilestoneUpdate = Database['public']['Tables']['milestones']['Update']

export const INVOICE_STATES = ['offen', 'gestellt', 'bezahlt'] as const
export type InvoiceStatus = (typeof INVOICE_STATES)[number]

/** Schlanke Projekt-Info fürs Dashboard (Auswahl + Anzeige). */
export interface ProjectLite {
  id: string
  name: string
  color: string | null
  client: string | null
  is_system: boolean
}

export interface DashboardData {
  milestones: Milestone[]
  projects: ProjectLite[]
}

/** Lädt alle Meilensteine und (nicht-System-)Projekte für die Auswahl. */
export async function fetchDashboard(): Promise<DashboardData> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')

  const [ms, proj] = await Promise.all([
    supabase.from('milestones').select('*').order('due_date', { nullsFirst: false }),
    supabase
      .from('projects')
      .select('id, name, color, client, is_system')
      .eq('is_system', false)
      .order('name'),
  ])

  if (ms.error) throw ms.error
  if (proj.error) throw proj.error

  return { milestones: ms.data, projects: proj.data }
}

export async function createMilestone(m: MilestoneInsert): Promise<Milestone> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase.from('milestones').insert(m).select().single()
  if (error) throw error
  return data
}

export async function updateMilestone(id: string, patch: MilestoneUpdate): Promise<Milestone> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('milestones')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMilestone(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { error } = await supabase.from('milestones').delete().eq('id', id)
  if (error) throw error
}
