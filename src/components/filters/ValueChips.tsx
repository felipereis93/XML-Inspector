import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { splitValues } from '../../lib/xml/filters'
import { cn } from '../../lib/cn'

interface Props {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  label?: string
  disabled?: boolean
  /** Limite de caracteres por valor, quando o esquema declara `WIDTH`. */
  maxLength?: number
}

/**
 * Entrada de múltiplos valores.
 *
 * Cada valor vira uma etiqueta. Enter e vírgula confirmam; colar uma coluna de
 * planilha vira várias etiquetas de uma vez, porque é assim que a lista de
 * códigos costuma chegar. Backspace com o campo vazio remove a última — é o
 * gesto que todo mundo já tenta.
 */
export function ValueChips({
  values,
  onChange,
  placeholder,
  label,
  disabled,
  maxLength,
}: Props) {
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)

  /** Acrescenta ignorando duplicatas — filtrar duas vezes pelo mesmo código
   *  não muda o resultado e só ocupa espaço. */
  const add = (raw: string) => {
    const incoming = splitValues(raw)
    if (incoming.length === 0) return
    const seen = new Set(values.map((v) => v.toLowerCase()))
    const next = [...values]
    for (const value of incoming) {
      if (seen.has(value.toLowerCase())) continue
      seen.add(value.toLowerCase())
      next.push(value)
    }
    if (next.length !== values.length) onChange(next)
    setDraft('')
  }

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault()
      add(draft)
      return
    }
    if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      event.preventDefault()
      onChange(values.slice(0, -1))
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!/[,;\t\r\n]/.test(text)) return
    event.preventDefault()
    add(draft + text)
  }

  return (
    <div
      onClick={() => input.current?.focus()}
      className={cn(
        'flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-[var(--hairline)]',
        'bg-[var(--surface-raised)] px-1.5 py-1 transition-colors',
        'focus-within:border-brand-500 hover:border-brand-500/60',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded bg-brand-100 py-px pr-0.5 pl-1.5 font-mono text-[11px] text-brand-700"
        >
          <span className="truncate">{value}</span>
          <button
            type="button"
            aria-label={`Remover ${value}`}
            onClick={(event) => {
              event.stopPropagation()
              onChange(values.filter((_, i) => i !== index))
            }}
            className="flex size-3.5 shrink-0 items-center justify-center rounded-sm hover:bg-brand-500 hover:text-white"
          >
            <X size={10} />
          </button>
        </span>
      ))}

      <input
        ref={input}
        value={draft}
        aria-label={label}
        maxLength={maxLength}
        placeholder={values.length === 0 ? placeholder : '+'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKey}
        onPaste={handlePaste}
        // Confirmar ao sair evita o valor digitado sumir sem virar etiqueta.
        onBlur={() => add(draft)}
        className="min-w-14 flex-1 bg-transparent font-mono text-[12px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
      />
    </div>
  )
}
