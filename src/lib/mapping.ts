// Mapping-Admin: nicht zugeordnete Sync-Einträge (Mite/Zoho) sichtbar machen und
// – für Mite – manuell einem Projekt zuordnen (project_external_map).
// Quelle der unmatched-Daten: Tabelle sync_unmatched (von den Syncs befüllt).
import { supabase } from './supabase'
import type { Database } from './database.types'

export type UnmatchedRow = Database['public']['Tables']['sync_unmatched']['Row']

export interface OverrideRow {
  source: string
  external_id: string
  project_id: string
  note: string | null
  project_name: string
}

export interface ProjectOption {
  id: string
  name: string
  offer_number: string | null
  client: string | null
}

// Zoho-Abgrenzungen ohne Projekt sind oft sehr viele (Rechnungs-Splits außerhalb
// des synchronisierten Deal-Bereichs) → nur die größten N als Signal anzeigen.
export const ZOHO_SAMPLE_LIMIT = 50

export interface MappingData {
  miteUnmatched: UnmatchedRow[]
  zohoUnmatched: UnmatchedRow[] // größte ZOHO_SAMPLE_LIMIT nach Umsatz
  zohoCount: number // Gesamtzahl unmatched Abgrenzungen
  overrides: OverrideRow[]
  projects: ProjectOption[]
}

function sb() {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  return supabase
}

export async function fetchMapping(): Promise<MappingData> {
  const s = sb()
  // Getrennt je Quelle abfragen: Zoho kann >1000 Zeilen haben (PostgREST-Cap).
  const [mite, zohoHead, zohoSample, ov, proj] = await Promise.all([
    s.from('sync_unmatched').select('*').eq('source', 'mite').order('label'),
    s.from('sync_unmatched').select('external_id', { count: 'exact', head: true }).eq('source', 'zoho-abgrenzung'),
    s.from('sync_unmatched').select('*').eq('source', 'zoho-abgrenzung').order('amount_eur', { ascending: false, nullsFirst: false }).limit(ZOHO_SAMPLE_LIMIT),
    s.from('project_external_map').select('source, external_id, project_id, note').order('external_id'),
    s.from('projects').select('id, name, offer_number, client').eq('is_system', false).order('name'),
  ])
  if (mite.error) throw mite.error
  if (zohoHead.error) throw zohoHead.error
  if (zohoSample.error) throw zohoSample.error
  if (ov.error) throw ov.error
  if (proj.error) throw proj.error

  const projects = proj.data as ProjectOption[]
  const nameById = new Map(projects.map((p) => [p.id, p.name]))
  const overrides: OverrideRow[] = (ov.data ?? []).map((o) => ({
    source: o.source,
    external_id: o.external_id,
    project_id: o.project_id,
    note: o.note,
    project_name: nameById.get(o.project_id) ?? '(unbekanntes Projekt)',
  }))

  return {
    miteUnmatched: mite.data,
    zohoUnmatched: zohoSample.data,
    zohoCount: zohoHead.count ?? 0,
    overrides,
    projects,
  }
}

/** Mite-Projekt (external_id) einem Projekt zuordnen und die unmatched-Zeile entfernen.
 *  Der nächste Mite-Sync zieht die Ist-Zeiten dann auf das Projekt. */
export async function assignMiteOverride(externalId: string, projectId: string, note?: string): Promise<void> {
  const s = sb()
  const up = await s
    .from('project_external_map')
    .upsert({ source: 'mite', external_id: externalId, project_id: projectId, note: note ?? null }, { onConflict: 'source,external_id' })
  if (up.error) throw up.error
  // Optimistisch aus der unmatched-Liste entfernen (sonst erst beim nächsten Sync).
  const del = await s.from('sync_unmatched').delete().eq('source', 'mite').eq('external_id', externalId)
  if (del.error) throw del.error
}

/** Bestehende Zuordnung (Ausnahme) entfernen. */
export async function removeOverride(source: string, externalId: string): Promise<void> {
  const { error } = await sb().from('project_external_map').delete().eq('source', source).eq('external_id', externalId)
  if (error) throw error
}

/** Einen unmatched-Eintrag ausblenden (kommt beim nächsten Sync wieder, falls weiter unmatched). */
export async function ignoreUnmatched(source: string, externalId: string): Promise<void> {
  const { error } = await sb().from('sync_unmatched').delete().eq('source', source).eq('external_id', externalId)
  if (error) throw error
}

export interface SyncResult {
  ok: boolean
  actuals_upserted?: number
  milestones_upserted?: number
  unmatched?: unknown
  error?: string
}

/** Mite-Sync manuell auslösen (aktualisiert Ist-Zeiten + unmatched-Liste). */
export async function triggerMiteSync(): Promise<SyncResult> {
  const { data, error } = await sb().functions.invoke('sync-mite', { method: 'POST' })
  if (error) throw error
  const result = data as SyncResult
  if (!result.ok) throw new Error(result.error ?? 'Mite-Sync fehlgeschlagen')
  return result
}
