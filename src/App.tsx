import { useState } from 'react'
import WeekGrid from './components/WeekGrid'
import Dashboard from './components/Dashboard'
import Projects from './components/Projects'
import Analytics from './components/Analytics'
import Admin from './components/Admin'
import Login from './components/Login'
import { supabaseConfigured } from './lib/supabase'
import { signOut, useSession } from './lib/auth'

type Tab = 'raster' | 'projekte' | 'dashboard' | 'auswertung' | 'admin'

export default function App() {
  const { session, loading } = useSession()
  const [tab, setTab] = useState<Tab>('raster')
  // Sprung aus der Auswertung ins Planungsraster zu einem bestimmten Monat.
  const [jumpWeek, setJumpWeek] = useState<Date | null>(null)

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
        <nav className="tabs">
          <button
            className={`tab${tab === 'raster' ? ' active' : ''}`}
            onClick={() => { setTab('raster'); setJumpWeek(null) }}
          >
            Billy
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
            Meilensteine
          </button>
          <button
            className={`tab${tab === 'auswertung' ? ' active' : ''}`}
            onClick={() => setTab('auswertung')}
          >
            Auswertung
          </button>
          <button
            className={`tab${tab === 'admin' ? ' active' : ''}`}
            onClick={() => setTab('admin')}
          >
            Verwaltung
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
        {tab === 'raster' && <WeekGrid initialMonday={jumpWeek} />}
        {tab === 'projekte' && <Projects />}
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'auswertung' && (
          <Analytics onOpenWeek={(d) => { setJumpWeek(d); setTab('raster') }} />
        )}
        {tab === 'admin' && <Admin />}
      </main>
    </div>
  )
}
