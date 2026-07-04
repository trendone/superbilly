import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Fängt Render-Fehler ab, damit ein einzelner Fehler nicht die ganze App
 * zum Weißbild macht. Zeigt einen freundlichen Fallback mit „neu laden".
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sichtbar in der Browser-Konsole; hier könnte später Sentry o. Ä. andocken.
    console.error('Unerwarteter Fehler in superbilly:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="shell">
          <div className="card">
            <h1>superbilly</h1>
            <p className="sub">Ressourcenplanung</p>
            <div className="status pending">
              ○ Es ist ein unerwarteter Fehler aufgetreten. Die Ansicht konnte nicht
              geladen werden.
            </div>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Seite neu laden
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
