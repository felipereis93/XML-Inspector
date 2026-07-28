import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronRight,
  Columns2,
  Equal,
  Minus,
  Plus,
  Rows3,
  ScanSearch,
} from 'lucide-react'
import type { DiffRow, DiffStatus, XmlDocument } from '../../types/xml'
import { autoExpand, flattenDiff, type FlatDiffRow } from '../../lib/xml/diff'
import { useXmlDiff } from '../../hooks/useXmlAnalysis'
import { DepthGuides } from '../ui/DepthGuides'
import { Button, EmptyState, Segmented } from '../ui/controls'
import { formatInt } from '../../lib/xml/coerce'
import { cn } from '../../lib/cn'

const ROW_HEIGHT = 26

type Layout = 'split' | 'inline'

interface Props {
  left?: XmlDocument
  right?: XmlDocument
}

export function DiffView({ left, right }: Props) {
  const { rows, summary, identical } = useXmlDiff(left, right)
  const [layout, setLayout] = useState<Layout>('split')
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  // Abrir todo o caminho até cada diferença é o estado útil por padrão:
  // ninguém compara dois arquivos para depois clicar até achar a mudança.
  useEffect(() => setExpanded(autoExpand(rows)), [rows])

  const flat = useMemo(
    () => flattenDiff(rows, { expanded, onlyDifferences }),
    [rows, expanded, onlyDifferences],
  )

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  if (!left || !right) {
    return (
      <EmptyState
        icon={<Columns2 size={28} strokeWidth={1.5} />}
        title="Escolha dois arquivos para comparar"
        hint="Selecione o documento de cada lado no topo. A comparação é estrutural, então reindentar o arquivo não conta como diferença."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--hairline)] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Tally status="added" count={summary.added} label="adicionados" />
          <Tally status="removed" count={summary.removed} label="removidos" />
          <Tally status="changed" count={summary.changed} label="alterados" />
          <Tally status="equal" count={summary.equal} label="iguais" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={onlyDifferences ? 'solid' : 'outline'}
            size="sm"
            onClick={() => setOnlyDifferences((v) => !v)}
            aria-pressed={onlyDifferences}
          >
            <ScanSearch size={13} />
            Só diferenças
          </Button>
          <Segmented<Layout>
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'split', label: 'Lado a lado', icon: <Columns2 size={13} /> },
              { value: 'inline', label: 'Em linha', icon: <Rows3 size={13} /> },
            ]}
          />
        </div>
      </header>

      {layout === 'split' && (
        <div className="grid grid-cols-2 divide-x divide-[var(--hairline)] border-b border-[var(--hairline)] text-[11px]">
          <FileLabel doc={left} side="Original" />
          <FileLabel doc={right} side="Comparado" />
        </div>
      )}

      {identical ? (
        <EmptyState
          icon={<Equal size={28} strokeWidth={1.5} />}
          title="Os dois arquivos são equivalentes"
          hint="Mesma estrutura, mesmos atributos, mesmos valores. Diferenças de indentação e de quebra de linha são ignoradas."
        />
      ) : flat.length === 0 ? (
        <EmptyState
          icon={<Equal size={28} strokeWidth={1.5} />}
          title="Nada para mostrar aqui"
          hint="Desligue “Só diferenças” para ver a árvore completa."
        />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-[12.5px]">
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = flat[item.index]
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {layout === 'split' ? (
                    <SplitRow row={row} left={left} right={right} onToggle={toggle} />
                  ) : (
                    <InlineRow row={row} left={left} right={right} onToggle={toggle} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function FileLabel({ doc, side }: { doc: XmlDocument; side: string }) {
  return (
    <div className="flex items-baseline gap-2 px-4 py-1.5">
      <span className="eyebrow">{side}</span>
      <span className="truncate font-mono text-[11px] text-[var(--fg-muted)]">
        {doc.fileName}
      </span>
    </div>
  )
}

const TONE: Record<DiffStatus, string> = {
  added: 'text-added',
  removed: 'text-removed',
  changed: 'text-changed',
  equal: 'text-[var(--fg-subtle)]',
}

function Tally({
  status,
  count,
  label,
}: {
  status: DiffStatus
  count: number
  label: string
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn('num font-display text-[15px] font-semibold', TONE[status])}
      >
        {formatInt(count)}
      </span>
      <span className="text-[11px] text-[var(--fg-muted)]">{label}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */

/**
 * O estado de cada linha é dito três vezes: barra colorida à esquerda, fundo
 * tingido e glifo (+ − ~). Numa paleta em que o verde da marca também é cor de
 * valor, matiz sozinha não basta para distinguir "adicionado" — e a redundância
 * é o que mantém o diff legível para quem não separa verde de vermelho.
 */
const ROW_BG: Record<DiffStatus, string> = {
  added: 'border-l-2 border-l-added bg-added/[0.09]',
  removed: 'border-l-2 border-l-removed bg-removed/[0.08]',
  changed: 'border-l-2 border-l-changed bg-changed/[0.10]',
  equal: 'border-l-2 border-l-transparent',
}

function SplitRow({
  row,
  left,
  right,
  onToggle,
}: {
  row: FlatDiffRow
  left: XmlDocument
  right: XmlDocument
  onToggle: (id: number) => void
}) {
  return (
    <div className="grid h-[26px] grid-cols-2 divide-x divide-[var(--hairline)]">
      <Cell
        row={row}
        doc={left}
        nodeId={row.left}
        side="left"
        onToggle={onToggle}
      />
      <Cell
        row={row}
        doc={right}
        nodeId={row.right}
        side="right"
        onToggle={onToggle}
      />
    </div>
  )
}

function InlineRow({
  row,
  left,
  right,
  onToggle,
}: {
  row: FlatDiffRow
  left: XmlDocument
  right: XmlDocument
  onToggle: (id: number) => void
}) {
  // Um nó alterado ocupa duas linhas visuais no modo em linha, mas a lista é
  // virtualizada com altura fixa: mostramos antes -> depois na mesma linha.
  const doc = row.right !== undefined ? right : left
  const nodeId = row.right ?? row.left
  return (
    <div className={cn('flex h-[26px] items-center', ROW_BG[row.status])}>
      <Cell
        row={row}
        doc={doc}
        nodeId={nodeId}
        side="right"
        inline
        onToggle={onToggle}
      />
    </div>
  )
}

const MARKER: Record<DiffStatus, { glyph: React.ReactNode; className: string }> = {
  added: { glyph: <Plus size={11} strokeWidth={3} />, className: 'text-added' },
  removed: { glyph: <Minus size={11} strokeWidth={3} />, className: 'text-removed' },
  changed: { glyph: <span className="text-[13px] leading-none">~</span>, className: 'text-changed' },
  equal: { glyph: null, className: '' },
}

function Cell({
  row,
  doc,
  nodeId,
  side,
  inline,
  onToggle,
}: {
  row: FlatDiffRow
  doc: XmlDocument
  nodeId?: number
  side: 'left' | 'right'
  inline?: boolean
  onToggle: (id: number) => void
}) {
  // Lado ausente: faixa listrada, para que a falta seja legível como falta e
  // não como uma linha em branco qualquer.
  if (nodeId === undefined) {
    return (
      <div
        className="h-[26px] bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--hairline)_6px,var(--hairline)_7px)] opacity-40"
        aria-hidden
      />
    )
  }

  const node = doc.nodes[nodeId]
  const marker = MARKER[row.status]
  const changedAttrs = new Set(row.attrChanges.map((c) => c.name))
  const valueChanged =
    row.status === 'changed' && (row.leftValue ?? '') !== (row.rightValue ?? '')

  return (
    <div
      className={cn(
        'flex h-[26px] items-center overflow-hidden pr-3',
        !inline && ROW_BG[row.status],
      )}
    >
      <span
        className={cn(
          'flex w-5 shrink-0 items-center justify-center',
          marker.className,
        )}
        aria-hidden
      >
        {marker.glyph}
      </span>

      <DepthGuides depth={row.depth} />

      <button
        type="button"
        onClick={() => onToggle(row.id)}
        aria-label={row.expanded ? 'Recolher nó' : 'Expandir nó'}
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-sm text-[var(--fg-subtle)]',
          row.hasChildren ? 'hover:text-[var(--fg)]' : 'invisible',
        )}
      >
        <ChevronRight
          size={13}
          className={cn('transition-transform', row.expanded && 'rotate-90')}
        />
      </button>

      <span className="truncate">
        <span className="text-[var(--fg-subtle)]">&lt;</span>
        <span className={cn('font-medium', row.status === 'equal' ? 'text-[var(--fg-muted)]' : TONE[row.status])}>
          {node.name}
        </span>
        {Object.entries(node.attrs).map(([name, value]) => (
          <span
            key={name}
            className={cn(
              'text-[var(--fg-subtle)]',
              changedAttrs.has(name) && 'rounded-sm bg-changed/25 text-changed',
            )}
          >
            {' '}
            {name}
            <span className="opacity-60">="</span>
            {value}
            <span className="opacity-60">"</span>
          </span>
        ))}
        <span className="text-[var(--fg-subtle)]">&gt;</span>

        {node.value !== undefined && (
          <span
            className={cn(
              'ml-2',
              valueChanged
                ? 'rounded-sm bg-changed/25 px-1 text-changed'
                : 'text-[var(--fg-muted)]',
            )}
          >
            {node.value}
          </span>
        )}

        {inline && valueChanged && side === 'right' && (
          <span className="ml-2 text-[var(--fg-subtle)]">
            (antes:{' '}
            <span className="text-removed line-through">{row.leftValue ?? '—'}</span>)
          </span>
        )}

        {row.status === 'equal' && row.hasChangedDescendants && !row.expanded && (
          <span className="ml-2 rounded-full bg-changed/15 px-1.5 text-[10px] text-changed">
            mudanças dentro
          </span>
        )}
      </span>
    </div>
  )
}

export type { DiffRow }
