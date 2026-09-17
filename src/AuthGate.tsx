import { useEffect } from 'react'
import App from './App'
import { LoginScreen } from './components/auth/LoginScreen'
import { useAuth } from './store/useAuth'

/**
 * Porta de entrada: decide entre tela de login e aplicação a partir da
 * sessão (cookie httpOnly, checado uma vez contra o servidor ao montar).
 * `App` fica fora dessa decisão — ele só é montado quando já há sessão
 * válida, e não precisa saber que autenticação existe.
 */
export function AuthGate() {
  const status = useAuth((s) => s.status)
  const checkSession = useAuth((s) => s.checkSession)

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--fg-muted)]">
        Carregando…
      </div>
    )
  }
  if (status === 'signed-out') return <LoginScreen />
  return <App />
}
