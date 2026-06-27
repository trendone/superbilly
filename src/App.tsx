import { useState } from 'react'
import WeekGrid from './components/WeekGrid'
import Dashboard from './components/Dashboard'
import Projects from './components/Projects'
import Login from './components/Login'
import { supabaseConfigured } from './lib/supabase'
import { signOut, useSession } from './lib/auth'

type Tab = 'raster' | 'projekte' | 'dashboard'

export default function App() {
  const { session, loading } = useSession()
  const [tab, setTab] = useState<Tab>('raster')

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
        <nav className="tabs">
          <button
            className={`tab${tab === 'raster' ? ' active' : ''}`}
            onClick={() => setTab('raster')}
          >
            Buchungsraster
          </button>
          <button
            className={`tab${tab === 'projekte' ? ' active' : ''}`}
            onClick={() => setTab('projekte')}
          >
            Projekte
          </button>
          <button
            className={`tab${tab === 'dashboard' ? ' active' : ''}`}
            onClick={() => setTab('dashboard')}
          >
            Rechnungen
          </button>
        </nav>
        <div className="topbar-right">
          <span className="user-email">{email}</span>
          <button className="btn-ghost" onClick={() => signOut()}>
            Abmelden
          </button>
        </div>
      </header>
      <main className="main">
        {tab === 'raster' && <WeekGrid />}
        {tab === 'projekte' && <Projects />}
        {tab === 'dashboard' && <Dashboard />}
      </main>
    </div>
  )
}
