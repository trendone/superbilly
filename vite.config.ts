import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Port an die Supabase "Site URL" (localhost:3000) angeglichen, damit der
  // Magic-Link nach dem Klick wieder in der laufenden App landet.
  server: { port: 3000, strictPort: true },
})
