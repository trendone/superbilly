import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True once both env vars are present (set in .env.local or Vercel). */
export const supabaseConfigured = Boolean(url && anonKey)

/**
 * Supabase client – null until configured, so the app can render a clear
 * "noch nicht verbunden"-Hinweis statt zu crashen.
 */
export const supabase: SupabaseClient<Database> | null = supabaseConfigured
  ? createClient<Database>(url, anonKey)
  : null
