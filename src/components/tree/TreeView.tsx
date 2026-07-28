import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, FileSearch } from 'lucide-react'
import type { DocumentEdits, XmlDocument } from '../../types/xml'
import { flattenTree, type TreeRow } from '../../lib/xml/flatten'
import { isNodeEdited } from '../../lib/xml/edits'
import { DepthGuides } from '../ui/DepthGuides'
import { Highlight } from '../ui/Highlight'
import { EditedDot } from '../edit/EditableField'
import { EmptyState } from '../ui/controls'
import { cn } from '../../lib/cn'

const ROW_HEIGHT = 26

interface Props {
  doc: XmlDocument
  expanded: Set<number>
  visible: Set<number> | null
  matched: Set<number>
  query: string
  selected?: number
  edits?: DocumentEdits
  onToggle: (id: number) => void
  onSelect: (id: number) => void
}

export function TreeView({
  doc,
  expanded,
  visible,
  matched,
  query,
  selected,
  edits,
  onToggle,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => flattenTree(doc, { expanded, visible, matched }),
    [doc, expanded, visible, matched],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  })

  // Ao trocar de busca, leva a primeira ocorrência para a tela.
  const firstMatch = useMemo(
    () => rows.findIndex((row) => row.matched),
    [rows],
  )
  useEffect(() => {
    if (query && firstMatch >= 0) {
      virtualizer.scrollToIndex(firstMatch, { align: 'center' })
    }
    // Reposicionar a cada mudança de linha seria hostil durante a navegação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileSearch size={28} strokeWidth={1.5} />}
        title="Nenhum nó corresponde aos filtros"
        hint="Ajuste ou remova um filtro no painel à esquerda para ver o documento de novo."
      />
    )
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto font-mono text-[12.5px] leading-none"
      role="tree"
      aria-label={`Estrutura de ${doc.fileName}`}
    >
      {/* Rolagem só na vertical: as linhas são posicionadas em absoluto, então
          uma largura definida pelo conteúdo não teria de onde vir. Linha longa
          é truncada — o painel direito mostra o nó inteiro. */}
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => (
          <Row
            key={item.key}
            row={rows[item.index]}
            doc={doc}
            query={query}
            selected={selected === rows[item.index].id}
            edited={isNodeEdited(edits, rows[item.index].id)}
            top={item.start}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function Row({
  row,
  doc,
  query,
  selected,
  edited,
  top,
  onToggle,
  onSelect,
}: {
  row: TreeRow
  doc: XmlDocument
  query: string
  selected: boolean
  edited: boolean
  top: number
  onToggle: (id: number) => void
  onSelect: (id: number) => void
}) {
  const node = doc.nodes[row.id]
  const attrs = Object.entries(node.attrs)

  return (
    <div
      role="treeitem"
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-level={row.depth + 1}
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(row.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (row.hasChildren) onToggle(row.id)
          else onSelect(row.id)
        }
        if (event.key === 'ArrowRight' && row.hasChildren && !row.expanded) {
          onToggle(row.id)
        }
        if (event.key === 'ArrowLeft' && row.hasChildren && row.expanded) {
          onToggle(row.id)
        }
      }}
      className={cn(
        'absolute inset-x-0 flex h-[26px] cursor-default items-center overflow-hidden pr-4',
        'hover:bg-[var(--hover)]',
        // A seleção ganha barra à esquerda além do fundo: em uma paleta de um
        // matiz só, fundo sozinho não separa "selecionado" de "sob o cursor".
        selected &&
          'bg-[var(--selected)] shadow-[inset_2px_0_0_0_var(--color-brand-500)] hover:bg-[var(--selected)]',
        row.matched && !selected && 'bg-[var(--hover)]',
        edited && !selected && 'bg-changed/[0.08]',
      )}
      style={{ transform: `translateY(${top}px)` }}
    >
      <DepthGuides depth={row.depth} />

      <button
        type="button"
        tabIndex={-1}
        aria-hidden={!row.hasChildren}
        onClick={(event) => {
          event.stopPropagation()
          if (row.hasChildren) onToggle(row.id)
        }}
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-sm text-brand-500',
          row.hasChildren ? 'hover:bg-brand-100 hover:text-brand-700' : 'invisible',
        )}
      >
        <ChevronRight
          size={13}
          className={cn('transition-transform', row.expanded && 'rotate-90')}
        />
      </button>

      {/* Hierarquia de leitura: nome do nó em #333, chave de atributo em #555,
          valor em verde. Três níveis, do estrutural ao dado. */}
      <span className="ml-0.5 shrink-0">
        <span className="text-[var(--fg-subtle)]">&lt;</span>
        <Highlight
          text={node.name}
          query={query}
          className="font-semibold text-[var(--fg)]"
        />
        {attrs.map(([name, value]) => (
          <span key={name}>
            {' '}
            <Highlight
              text={name}
              query={query}
              className="text-[var(--fg-key)]"
            />
            <span className="text-[var(--fg-subtle)]">="</span>
            <Highlight
              text={value}
              query={query}
              className="text-[var(--fg-value)]"
            />
            <span className="text-[var(--fg-subtle)]">"</span>
          </span>
        ))}
        <span className="text-[var(--fg-subtle)]">&gt;</span>
      </span>

      {node.value !== undefined && (
        <span className="ml-2 min-w-0 truncate">
          <Highlight
            text={node.value}
            query={query}
            className={cn(
              'text-[var(--fg-value)]',
              node.num !== undefined && 'num',
            )}
          />
        </span>
      )}

      {row.hasChildren && !row.expanded && (
        <span className="num ml-2 shrink-0 rounded-full border border-[var(--hairline)] px-1.5 py-px text-[10px] text-[var(--fg-subtle)]">
          {node.children.length}
        </span>
      )}

      {edited && <EditedDot className="ml-2" />}
    </div>
  )
}
