import WeekGrid from './components/WeekGrid'
import Login from './components/Login'
import { supabaseConfigured } from './lib/supabase'
import { signOut, useSession } from './lib/auth'

export default function App() {
  const { session, loading } = useSession()

  if (!supabaseConfigured) {
    return (
      <div className="shell">
        <div className="card">
          <h1>superbilly</h1>
          <p className="sub">Ressourcenplanung</p>
          <div className="status pending">
            ○ Supabase nicht verbunden – VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY
            in .env.local setzen
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="shell">
        <div className="card">
          <div className="status pending">○ Lade…</div>
        </div>
      </div>
    )
  }

  if (!session) return <Login />

  const email = session.user.email ?? ''

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">superbilly</div>
        <div className="brand-sub">Ressourcenplanung</div>
        <div className="topbar-right">
          <span className="user-email">{email}</span>
          <button className="btn-ghost" onClick={() => signOut()}>
            Abmelden
          </button>
        </div>
      </header>
      <main className="main">
        <WeekGrid />
      </main>
    </div>
  )
}
