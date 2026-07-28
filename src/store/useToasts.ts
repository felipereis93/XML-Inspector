import { create } from 'zustand'

/**
 * Store de avisos efêmeros de ação concluída.
 *
 * Separada de `Toast.tsx` — que fica só com os componentes — porque um
 * arquivo que mistura export de função com export de componente derruba o
 * Fast Refresh do Vite para reload completo a cada edição em dev. Aqui não
 * há esse problema: só store e função solta.
 */

export type ToastTone = 'success' | 'error'

export interface Toast {
  id: string
  tone: ToastTone
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (tone: ToastTone, message: string) => void
  dismiss: (id: string) => void
}

const DURATION = 4000

/**
 * Timers de auto-dismiss, fora do estado da store: não são dado de render,
 * são só o que permite cancelar o `setTimeout` quando o usuário dispensa o
 * toast manualmente antes dos 4s (senão sobra um `set()` fantasma depois).
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }))
    const timer = setTimeout(() => {
      timers.delete(id)
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, DURATION)
    timers.set(id, timer)
  },
  dismiss: (id) => {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

/** Fora de componente: quem avisa costuma ser um handler, não um render. */
export function pushToast(tone: ToastTone, message: string): void {
  useToasts.getState().push(tone, message)
}
