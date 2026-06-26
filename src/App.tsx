import { supabaseConfigured } from './lib/supabase'

export default function App() {
  return (
    <main className="shell">
      <div className="card">
        <h1>superbilly</h1>
        <p className="sub">Ressourcenplanung – Neuaufbau (Supabase · React · Vite)</p>

        <div className={`status ${supabaseConfigured ? 'ok' : 'pending'}`}>
          {supabaseConfigured
            ? '● Supabase verbunden'
            : '○ Supabase noch nicht verbunden – VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in .env.local setzen'}
        </div>

        <p className="hint">
          Konzept &amp; Roadmap: <code>konzept.md</code> · Status: v1.1 (Fundament)
        </p>
      </div>
    </main>
  )
}
