import WeekGrid from './components/WeekGrid'
import { supabaseConfigured } from './lib/supabase'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">superbilly</div>
        <div className="brand-sub">Ressourcenplanung</div>
      </header>
      <main className="main">
        {supabaseConfigured ? (
          <WeekGrid />
        ) : (
          <div className="status pending">
            ○ Supabase nicht verbunden – VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY
            in .env.local setzen
          </div>
        )}
      </main>
    </div>
  )
}
