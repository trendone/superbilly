import { supabase } from './supabase'

export interface ZohoSyncResult {
  ok: boolean
  projects_upserted: number
  projects_new: number
  projects_updated: number
  error?: string
}

/** Löst den manuellen Zoho-Abruf aus (sync-zoho Edge Function). */
export async function triggerZohoSync(): Promise<ZohoSyncResult> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase.functions.invoke('sync-zoho', { method: 'POST' })
  if (error) throw error
  const result = data as ZohoSyncResult
  if (!result.ok) throw new Error(result.error ?? 'Zoho-Abruf fehlgeschlagen')
  return result
}
