// Admin-Datenschicht: Mitarbeiter (inkl. Arbeitszeit-Perioden) und
// System-Kategorien (Urlaub/Krank/Admin/Frei/…). RLS erlaubt authenticated
// Vollzugriff (v1.1). Portiert aus der alten Billy-App (app.js).
import { supabase } from './supabase'
import type { Database } from './database.types'

export type Employee = Database['public']['Tables']['employees']['Row']
export type EmployeeInsert = Database['public']['Tables']['employees']['Insert']
export type EmployeeUpdate = Database['public']['Tables']['employees']['Update']
export type HoursPeriod = Database['public']['Tables']['employee_hours_periods']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Department = Database['public']['Tables']['departments']['Row']
export type UserRole = Database['public']['Tables']['user_roles']['Row']

function sb() {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  return supabase
}

export interface AdminData {
  employees: Employee[]
  periods: HoursPeriod[]
  systemProjects: Project[]
  departments: Department[]
  roles: UserRole[]
}

export async function fetchAdmin(): Promise<AdminData> {
  const s = sb()
  const [emp, per, proj, dep, rol] = await Promise.all([
    s.from('employees').select('*').order('name'),
    s.from('employee_hours_periods').select('*').order('valid_from'),
    s.from('projects').select('*').eq('is_system', true).order('name'),
    s.from('departments').select('*').order('sort_order').order('name'),
    s.from('user_roles').select('*').order('email'),
  ])
  if (emp.error) throw emp.error
  if (per.error) throw per.error
  if (proj.error) throw proj.error
  if (dep.error) throw dep.error
  if (rol.error) throw rol.error
  return { employees: emp.data, periods: per.data, systemProjects: proj.data, departments: dep.data, roles: rol.data }
}

// ── Rollen (Zugriffsrechte) ──────────────────────────────────────────────────
// Admin darf den Bereich „Verwaltung" nutzen. Wer keinen Eintrag hat, ist „user".
// Schreiben ist per RLS auf Admins beschränkt (is_admin()).
export async function grantAdmin(email: string): Promise<void> {
  const { error } = await sb()
    .from('user_roles')
    .upsert({ email: email.trim().toLowerCase(), role: 'admin' }, { onConflict: 'email' })
  if (error) throw error
}
export async function revokeAdmin(email: string): Promise<void> {
  // Zurück auf „user" = Eintrag entfernen (fehlender Eintrag gilt als user).
  const { error } = await sb().from('user_roles').delete().eq('email', email.trim().toLowerCase())
  if (error) throw error
}

// ── Mitarbeiter ──────────────────────────────────────────────────────────
export async function createEmployee(e: EmployeeInsert): Promise<Employee> {
  const { data, error } = await sb().from('employees').insert(e).select().single()
  if (error) throw error
  return data
}
export async function updateEmployee(id: string, patch: EmployeeUpdate): Promise<Employee> {
  const { data, error } = await sb().from('employees').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteEmployee(id: string): Promise<void> {
  const { error } = await sb().from('employees').delete().eq('id', id)
  if (error) throw error
}

// ── Arbeitszeit-Perioden (abweichende Wochenstunden ab Datum) ──────────────
export async function addPeriod(employee_id: string, valid_from: string, weekly_hours: number): Promise<HoursPeriod> {
  const { data, error } = await sb()
    .from('employee_hours_periods')
    .insert({ employee_id, valid_from, weekly_hours })
    .select()
    .single()
  if (error) throw error
  return data
}
export async function deletePeriod(id: string): Promise<void> {
  const { error } = await sb().from('employee_hours_periods').delete().eq('id', id)
  if (error) throw error
}

// ── System-Kategorien (is_system) ──────────────────────────────────────────
export async function createSystemCategory(name: string, color: string): Promise<Project> {
  const { data, error } = await sb()
    .from('projects')
    .insert({ name, color, is_system: true, status: 'aktiv' })
    .select()
    .single()
  if (error) throw error
  return data
}
export async function updateSystemCategory(id: string, patch: { name?: string; color?: string }): Promise<Project> {
  const { data, error } = await sb().from('projects').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ── Abteilungen ─────────────────────────────────────────────────────────────
export async function createDepartment(name: string, color: string): Promise<Department> {
  const { data, error } = await sb()
    .from('departments')
    .insert({ name, color })
    .select()
    .single()
  if (error) throw error
  return data
}
export async function updateDepartment(id: string, patch: { name?: string; color?: string }): Promise<Department> {
  const { data, error } = await sb().from('departments').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteDepartment(id: string): Promise<void> {
  // Mitarbeiter bleiben bestehen (department_id → null via ON DELETE SET NULL).
  const { error } = await sb().from('departments').delete().eq('id', id)
  if (error) throw error
}
