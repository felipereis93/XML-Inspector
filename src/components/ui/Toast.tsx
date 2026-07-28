import { useEffect } from 'react'
import { create } from 'zustand'
import { CheckCircle2, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { IconButton } from './controls'

/**
 * Avisos efêmeros de ação concluída.
 *
 * Separado da `FailureBar`, que é persistente e fica no fluxo da página: um
 * arquivo que não abriu precisa continuar visível até ser lido, um "salvo com
 * sucesso" não. Store própria e não estado do `App` para que qualquer camada
 * possa avisar sem receber prop nenhuma.
 */

export type ToastTone = 'success' | 'error'

interface Toast {
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

const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }))
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      DURATION,
    )
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Fora de componente: quem avisa costuma ser um handler, não um render. */
export function pushToast(tone: ToastTone, message: string): void {
  useToasts.getState().push(tone, message)
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: string) => void
}) {
  // Fecha com Esc: o toast cobre o rodapé da tabela enquanto está visível.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss(toast.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toast.id, onDismiss])

  const error = toast.tone === 'error'

  return (
    <div
      className={cn(
        'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border px-3 py-2 shadow-lg',
        'bg-[var(--surface)] text-[13px]',
        error ? 'border-removed/50' : 'border-brand-500/50',
      )}
    >
      {error ? (
        <TriangleAlert size={15} className="shrink-0 text-removed" />
      ) : (
        <CheckCircle2 size={15} className="shrink-0 text-brand-500" />
      )}
      <p className="min-w-0 flex-1">{toast.message}</p>
      <IconButton
        label="Dispensar aviso"
        className="size-6 shrink-0"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={13} />
      </IconButton>
    </div>
  )
}
