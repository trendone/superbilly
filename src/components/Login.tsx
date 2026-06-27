import { useState } from 'react'
import { ALLOWED_DOMAINS, isAllowedEmail, sendMagicLink } from '../lib/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isAllowedEmail(email)) {
      setError(`Bitte eine @${ALLOWED_DOMAINS[0]}-Adresse verwenden.`)
      return
    }
    setBusy(true)
    try {
      await sendMagicLink(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <div className="card">
        <h1>superbilly</h1>
        <p className="sub">Ressourcenplanung – Anmeldung</p>

        {sent ? (
          <div className="status ok">
            ✓ Login-Link verschickt. Prüfe dein Postfach ({email}) und klicke den Link,
            um dich anzumelden.
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <label className="field-label" htmlFor="email">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              type="email"
              className="field"
              placeholder={`name@${ALLOWED_DOMAINS[0]}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
            {error && <div className="status err">{error}</div>}
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sende…' : 'Login-Link senden'}
            </button>
            <p className="hint">
              Du erhältst einen einmaligen Anmeldelink per E-Mail – kein Passwort nötig.
              Nur für <code>@{ALLOWED_DOMAINS[0]}</code>-Adressen.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
