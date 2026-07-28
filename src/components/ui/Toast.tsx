import { useEffect } from 'react'
import { CheckCircle2, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { IconButton } from './controls'
import { useToasts, type Toast } from '../../store/useToasts'

/**
 * Avisos efêmeros de ação concluída — só os componentes aqui. A store e
 * `pushToast` moraram para `src/store/useToasts.ts` (ver lá o porquê da
 * separação: é convenção do projeto para store zustand, e evita misturar
 * export de função com export de componente no mesmo arquivo).
 *
 * Separado da `FailureBar`, que é persistente e fica no fluxo da página: um
 * arquivo que não abriu precisa continuar visível até ser lido, um "salvo com
 * sucesso" não.
 */

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  // Um único listener para todos os toasts, não um por card: um por card
  // faria N handlers dispararem na mesma tecla, fechando os N de uma vez.
  // Esc fecha só o mais recente — lê o estado corrente na hora do evento,
  // não o `toasts` capturado no fechamento do efeito.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const last = useToasts.getState().toasts.at(-1)
      if (last) dismiss(last.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

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
