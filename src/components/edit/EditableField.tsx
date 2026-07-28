import { useEffect, useId, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { IconButton } from '../ui/controls'
import { cn } from '../../lib/cn'

interface Props {
  /** Valor em vigor — o editado, ou o original se não houver edição. */
  value: string
  /** Valor do arquivo original, mostrado quando o campo está alterado. */
  original: string
  edited: boolean
  onCommit: (value: string) => void
  onRevert: () => void
  label?: string
  /** Alinha à direita e usa numérico tabular. */
  numeric?: boolean
  /** Foca e seleciona ao montar — usado quando a célula abre em edição. */
  autoFocus?: boolean
  /** Chamado ao sair do campo, tendo gravado ou não. */
  onClose?: () => void
  /** Limite de caracteres declarado pelo esquema do arquivo (`WIDTH`). */
  maxLength?: number
  className?: string
  inputClassName?: string
}

/**
 * Campo editável com rascunho local.
 *
 * O valor só sobe para o estado global no commit (Enter ou saída do campo), e
 * não a cada tecla. Isso é deliberado: cada gravação recria o documento
 * efetivo e invalida busca, filtros, tabela e totais — fazer isso por
 * caractere digitado deixaria a digitação presa atrás do recálculo.
 *
 * Esc descarta o rascunho e volta ao valor em vigor, que não é o mesmo que
 * desfazer: desfazer volta ao valor do arquivo, e mora no botão ao lado.
 *
 * Com `maxLength`, o limite é imposto pelo atributo nativo — que também trunca
 * colagem — e o contador aparece ao focar. Valor que já vem do arquivo acima do
 * limite é sinalizado em vez de cortado: truncar dado de origem sem avisar seria
 * perder informação por conta própria.
 */
export function EditableField({
  value,
  original,
  edited,
  onCommit,
  onRevert,
  label,
  numeric,
  autoFocus,
  onClose,
  maxLength,
  className,
  inputClassName,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const counterId = useId()
  /** Esc marca o cancelamento antes do blur, que é quem grava. */
  const cancelled = useRef(false)

  // Enquanto o campo está em foco o rascunho manda; fora dele, o valor de fora
  // manda — é assim que "desfazer tudo" se reflete em um campo já renderizado.
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])

  useEffect(() => {
    if (autoFocus) input.current?.select()
  }, [autoFocus])

  const commit = () => {
    setFocused(false)
    if (!cancelled.current && draft !== value) onCommit(draft)
    cancelled.current = false
    onClose?.()
  }

  // `length` conta unidades UTF-16, igual ao atributo `maxlength` nativo. Manter
  // a mesma contagem evita um contador que discorda do que o input permite.
  const length = draft.length
  const limited = maxLength !== undefined
  /** O arquivo já trouxe um valor maior que a própria largura declarada. */
  const overflowing = limited && length > maxLength
  const atLimit = limited && length === maxLength
  const showCounter = limited && (focused || overflowing)

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div className="relative min-w-0 flex-1">
        <input
          ref={input}
          value={draft}
          aria-label={label}
          autoFocus={autoFocus}
          maxLength={maxLength}
          aria-invalid={overflowing || undefined}
          aria-describedby={showCounter ? counterId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              input.current?.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelled.current = true
              setDraft(value)
              input.current?.blur()
            }
          }}
          className={cn(
            'h-7 w-full min-w-0 rounded-md border bg-[var(--surface-raised)] px-2 font-mono text-[12px]',
            'transition-colors hover:border-brand-500/60 focus:border-brand-500',
            numeric && 'num text-right',
            showCounter && 'pr-12',
            overflowing
              ? 'border-removed bg-removed/[0.06] text-removed'
              : edited
                ? 'border-changed/60 bg-changed/[0.08] text-changed'
                : 'border-[var(--hairline)] text-[var(--fg)]',
            inputClassName,
          )}
        />

        {showCounter && (
          <span
            id={counterId}
            className={cn(
              'num pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] tabular-nums',
              overflowing
                ? 'font-semibold text-removed'
                : atLimit
                  ? 'font-semibold text-changed'
                  : 'text-[var(--fg-subtle)]',
            )}
            title={
              overflowing
                ? `O arquivo declara largura ${maxLength} para este campo, mas o valor tem ${length} caracteres.`
                : `Largura declarada no arquivo: ${maxLength} caracteres.`
            }
          >
            {length}/{maxLength}
          </span>
        )}
      </div>

      {edited && (
        <IconButton
          label={`Desfazer — voltar para "${original}"`}
          className="size-7 shrink-0 text-changed hover:bg-changed/15 hover:text-changed"
          onClick={onRevert}
        >
          <RotateCcw size={13} />
        </IconButton>
      )}
    </div>
  )
}

/** Selo de "alterado" reutilizado na árvore, na tabela e no inspetor. */
export function EditedBadge({ className }: { className?: string }) {
  return (
    <span
      title="Alterado — ainda não exportado"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-changed/15 px-1.5 py-px text-[10px] font-medium text-changed',
        className,
      )}
    >
      alterado
    </span>
  )
}

/** Marcador compacto para linhas densas, onde não cabe o selo com texto. */
export function EditedDot({ className }: { className?: string }) {
  return (
    <span
      title="Alterado — ainda não exportado"
      aria-label="Alterado"
      className={cn('inline-block size-1.5 shrink-0 rounded-full bg-changed', className)}
    />
  )
}
