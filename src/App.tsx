import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase'

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; categories: string[] }
  | { kind: 'error'; message: string }

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    if (!supabase) return
    setStatus({ kind: 'loading' })
    supabase
      .from('projects')
      .select('name')
      .eq('is_system', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) setStatus({ kind: 'error', message: error.message })
        else setStatus({ kind: 'ok', categories: (data ?? []).map((r) => r.name) })
      })
  }, [])

  return (
    <main className="shell">
      <div className="card">
        <h1>superbilly</h1>
        <p className="sub">Ressourcenplanung – Neuaufbau (Supabase · React · Vite)</p>

        {!supabaseConfigured && (
          <div className="status pending">
            ○ Supabase noch nicht verbunden – VITE_SUPABASE_URL und
            VITE_SUPABASE_ANON_KEY in .env.local setzen
          </div>
        )}

        {supabaseConfigured && status.kind === 'loading' && (
          <div className="status pending">… verbinde mit Supabase</div>
        )}

        {status.kind === 'error' && (
          <div className="status err">✕ Fehler: {status.message}</div>
        )}

        {status.kind === 'ok' && (
          <div className="status ok">
            ● Supabase verbunden – {status.categories.length} System-Kategorien
            geladen: {status.categories.join(', ')}
          </div>
        )}

        <p className="hint">
          Konzept &amp; Roadmap: <code>konzept.md</code> · Status: v1.1 (Fundament)
        </p>
      </div>
    </main>
  )
}
