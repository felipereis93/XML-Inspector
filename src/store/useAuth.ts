import { create } from 'zustand'
import * as api from '../lib/auth/api'
import type { AuthUser } from '../lib/auth/api'

/**
 * Sessão do usuário logado.
 *
 * `status` começa em `'loading'`: a primeira coisa que a aplicação faz é
 * perguntar ao servidor se o cookie que o navegador já mandou corresponde a
 * uma sessão válida, antes de decidir entre tela de login e aplicação —
 * `AuthGate` é quem dispara essa checagem, uma vez, ao montar.
 *
 * Login e cadastro não moram aqui: `LoginScreen` fala com `lib/auth/api`
 * diretamente e só chama `setSession` no fim, depois da própria animação de
 * sucesso — se o login mudasse o estado global assim que a senha fosse
 * validada, `AuthGate` desmontaria a tela antes de qualquer microinteração
 * ter chance de aparecer.
 */
interface AuthState {
  user?: AuthUser
  status: 'loading' | 'signed-out' | 'signed-in'
  checkSession: () => Promise<void>
  setSession: (user: AuthUser) => void
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',

  checkSession: async () => {
    try {
      const { user } = await api.me()
      set({ user, status: 'signed-in' })
    } catch {
      set({ user: undefined, status: 'signed-out' })
    }
  },

  setSession: (user) => set({ user, status: 'signed-in' }),

  logout: async () => {
    await api.logout().catch(() => {})
    set({ user: undefined, status: 'signed-out' })
  },
}))
