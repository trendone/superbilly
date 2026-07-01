import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Erlaubte E-Mail-Domain(s) für den Login (SSO/Org-Beschränkung, konzept.md §4.6). */
export const ALLOWED_DOMAINS = ['trendone.com']

/** Prüft clientseitig, ob eine Adresse zu einer erlaubten Domain gehört (UX-Vorabcheck;
 *  die verbindliche Durchsetzung erfolgt serverseitig per Postgres-Trigger). */
export function isAllowedEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1]
  return Boolean(domain) && ALLOWED_DOMAINS.includes(domain)
}

/**
 * Session-Hook. `loading` ist true, bis Supabase die bestehende Session geladen hat,
 * damit nicht kurz der Login aufblitzt. `session === null` → nicht angemeldet.
 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return { session, loading }
}

export type Role = 'admin' | 'user'

/**
 * Rolle des angemeldeten Nutzers. Wer nicht in `user_roles` steht, ist „user".
 * Nur „admin" darf den Bereich „Verwaltung" nutzen (Frontend-Gate + RLS).
 * `loading` verhindert kurzes Aufblitzen des Admin-Tabs vor der Prüfung.
 */
export function useRole(session: Session | null): { role: Role; loading: boolean } {
  const [role, setRole] = useState<Role>('user')
  const [loading, setLoading] = useState(true)

  const email = session?.user.email?.toLowerCase() ?? null
  useEffect(() => {
    let cancelled = false
    if (!supabase || !email) {
      setRole('user')
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('user_roles')
      .select('role')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setRole(data?.role === 'admin' ? 'admin' : 'user')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [email])

  return { role, loading }
}

/** Magic-Link an die angegebene Adresse senden. Wirft bei Fehlern. */
export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase nicht verbunden')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut()
}
