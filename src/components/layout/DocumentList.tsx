import { FileCode2, Plus, X } from 'lucide-react'
import type { XmlDocument } from '../../types/xml'
import { formatBytes, formatInt } from '../../lib/xml/coerce'
import { FilePicker } from '../upload/DropZone'
import { Button, Eyebrow, IconButton } from '../ui/controls'
import { cn } from '../../lib/cn'

interface Props {
  docs: XmlDocument[]
  activeId?: string
  leftId?: string
  rightId?: string
  comparing: boolean
  onSelect: (id: string) => void
  onSetSide: (side: 'left' | 'right', id: string) => void
  onRemove: (id: string) => void
  onFiles: (files: File[]) => void
}

export function DocumentList({
  docs,
  activeId,
  leftId,
  rightId,
  comparing,
  onSelect,
  onSetSide,
  onRemove,
  onFiles,
}: Props) {
  return (
    <section className="flex flex-col gap-2 border-b border-[var(--hairline)] p-4">
      <header className="flex items-center justify-between">
        <Eyebrow>Documentos ({docs.length})</Eyebrow>
        <FilePicker onFiles={onFiles}>
          <span className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--hairline)] px-2 text-xs text-[var(--fg-muted)] transition-colors hover:border-brand-500 hover:text-[var(--fg)]">
            <Plus size={13} />
            Abrir
          </span>
        </FilePicker>
      </header>

      <ul className="flex flex-col gap-1">
        {docs.map((doc) => {
          const active = comparing
            ? doc.id === leftId || doc.id === rightId
            : doc.id === activeId
          const side =
            doc.id === leftId ? 'A' : doc.id === rightId ? 'B' : undefined

          return (
            <li key={doc.id}>
              <div
                className={cn(
                  'group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors',
                  active
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-transparent hover:bg-[var(--hover)]',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <FileCode2
                    size={15}
                    className={cn(
                      'shrink-0',
                      active ? 'text-brand-500' : 'text-[var(--fg-subtle)]',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {doc.fileName}
                    </span>
                    <span className="num block text-[10.5px] text-[var(--fg-subtle)]">
                      {formatInt(doc.nodes.length)} nós · {formatBytes(doc.bytes)} ·{' '}
                      {doc.parseMs.toFixed(0)} ms
                    </span>
                  </span>
                </button>

                {comparing ? (
                  <div className="flex shrink-0 gap-0.5">
                    <SideChip
                      label="A"
                      active={doc.id === leftId}
                      onClick={() => onSetSide('left', doc.id)}
                    />
                    <SideChip
                      label="B"
                      active={doc.id === rightId}
                      onClick={() => onSetSide('right', doc.id)}
                    />
                  </div>
                ) : (
                  <>
                    {side && (
                      <span className="num shrink-0 rounded border border-[var(--hairline)] px-1 text-[10px] text-[var(--fg-subtle)]">
                        {side}
                      </span>
                    )}
                    <IconButton
                      label={`Fechar ${doc.fileName}`}
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => onRemove(doc.id)}
                    >
                      <X size={13} />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {docs.length === 0 && (
        <FilePicker onFiles={onFiles} className="w-full">
          <span className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-[var(--hairline)] px-3 py-6 text-center transition-colors hover:border-brand-500">
            <span className="text-[13px] font-medium">Abrir arquivos XML</span>
            <span className="text-[11.5px] text-[var(--fg-muted)]">
              ou arraste para qualquer lugar da janela
            </span>
          </span>
        </FilePicker>
      )}

      {docs.length === 1 && (
        <p className="text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
          Abra um segundo arquivo para liberar a comparação.
        </p>
      )}

      {comparing && docs.length >= 2 && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            if (leftId && rightId) {
              onSetSide('left', rightId)
              onSetSide('right', leftId)
            }
          }}
        >
          Inverter A e B
        </Button>
      )}
    </section>
  )
}

function SideChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'num size-6 rounded text-[11px] font-semibold transition-colors',
        active
          ? 'bg-brand-500 text-white'
          : 'border border-[var(--hairline)] text-[var(--fg-subtle)] hover:border-brand-500',
      )}
    >
      {label}
    </button>
  )
}
