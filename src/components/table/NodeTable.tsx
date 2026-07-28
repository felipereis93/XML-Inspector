import { useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Download, Table2 } from 'lucide-react'
import type { DocumentEdits, EditTarget, XmlDocument } from '../../types/xml'
import { declaredWidth, type DocumentSchema } from '../../lib/xml/schema'
import { useNodeTable } from '../../hooks/useXmlAnalysis'
import { columnTotal, toCsv, type TableRow } from '../../lib/xml/table'
import { isFieldEdited, originalValue } from '../../lib/xml/edits'
import { formatDecimal, formatInt, formatNumber } from '../../lib/xml/coerce'
import { Highlight } from '../ui/Highlight'
import { EditableField } from '../edit/EditableField'
import { Button, EmptyState, Eyebrow, Select } from '../ui/controls'
import { cn } from '../../lib/cn'

const ROW_HEIGHT = 30
/** Largura mínima de coluna; espelha o `min-w-32` das células. */
const COLUMN_WIDTH = 128

interface Props {
  doc?: XmlDocument
  schema: DocumentSchema
  original?: XmlDocument
  edits?: DocumentEdits
  path?: string
  scope: Set<number> | null
  query: string
  onPathChange: (path?: string) => void
  onSelectNode: (id: number) => void
  onEdit: (target: EditTarget, value: string) => void
  onRevertField: (target: EditTarget) => void
}

/** Célula em edição, identificada por linha e coluna. */
interface CellCursor {
  row: number
  column: string
}

/**
 * Tabela dinâmica dos nós repetidos.
 *
 * A grade não é configurada em lugar nenhum: as colunas são descobertas dos
 * próprios registros. Ganha um campo opcional no XML, ganha uma coluna aqui.
 *
 * A edição segue a convenção de planilha: duplo clique abre a célula, Enter e
 * saída do campo gravam, Esc descarta. Clique simples continua selecionando a
 * linha, para não transformar navegação em edição acidental.
 */
export function NodeTable({
  doc,
  schema,
  original,
  edits,
  path,
  scope,
  query,
  onPathChange,
  onSelectNode,
  onEdit,
  onRevertField,
}: Props) {
  const { repeating, table, resolvedPath } = useNodeTable(doc, schema, path, scope)
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<CellCursor | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () =>
      table.columns.map((column) => ({
        id: column.key,
        header: column.label,
        // Ordenar pelo número quando a coluna é numérica; ordenar pelo texto
        // ordenaria "1000" antes de "9".
        accessorFn: (row) =>
          column.numeric
            ? (row.nums[column.key] ?? null)
            : (row.cells[column.key] ?? ''),
        sortUndefined: 'last',
      })),
    [table.columns],
  )

  const grid = useReactTable({
    data: table.rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const rows = grid.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })

  if (!doc) return null

  if (repeating.length === 0) {
    return (
      <EmptyState
        icon={<Table2 size={28} strokeWidth={1.5} />}
        title="Este documento não tem registros tabuláveis"
        hint="A visão de tabela precisa de um nó que se repita ou que tenha ao menos dois campos — itens, lançamentos, registros de catálogo."
      />
    )
  }

  const numericColumns = table.columns.filter((c) => c.numeric)

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Eyebrow>Registro</Eyebrow>
          <Select
            value={resolvedPath ?? ''}
            onChange={(event) => onPathChange(event.target.value)}
            className="h-7 w-auto min-w-52 text-[12px]"
          >
            {repeating.map((profile) => (
              <option key={profile.path} value={profile.path}>
                {profile.leaf} · {formatInt(profile.count)} registros
              </option>
            ))}
          </Select>
        </div>

        <p className="text-[11.5px] text-[var(--fg-muted)]">
          <span className="num font-semibold text-[var(--fg)]">
            {formatInt(table.rows.length)}
          </span>{' '}
          linhas ·{' '}
          <span className="num font-semibold text-[var(--fg)]">
            {formatInt(table.columns.length)}
          </span>{' '}
          colunas
          {table.omittedColumns > 0 && ` (+${table.omittedColumns} ocultas)`}
        </p>

        {/* Rotulado com o formato para não ser confundido com salvar o XML:
            este botão exporta só a grade visível, como planilha. */}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          title="Exporta apenas esta tabela como planilha. Para salvar o XML, use o botão de download na barra superior."
          onClick={() => downloadCsv(table, doc.fileName)}
        >
          <Download size={13} />
          Exportar tabela (CSV)
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* A grade usa display block/flex em vez do layout de tabela: as linhas
            são posicionadas em absoluto pela virtualização, e `table-row` não
            aceita posicionamento de forma confiável entre navegadores. */}
        <table
          className="block text-[12px]"
          style={{ minWidth: table.columns.length * COLUMN_WIDTH }}
        >
          <thead className="sticky top-0 z-10 block">
            {grid.getHeaderGroups().map((group) => (
              <tr key={group.id} className="flex">
                {group.headers.map((header) => {
                  const numeric = table.columns.find(
                    (c) => c.key === header.column.id,
                  )?.numeric
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        'flex min-w-32 flex-1 items-center border-b border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 whitespace-nowrap',
                        numeric && 'justify-end',
                      )}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'eyebrow inline-flex items-center gap-1 hover:text-[var(--fg)]',
                          sorted && 'text-brand-500',
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sorted === 'asc' && <ArrowUp size={11} />}
                        {sorted === 'desc' && <ArrowDown size={11} />}
                      </button>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          <tbody
            className="relative block"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectNode(row.original.node)}
                  className="absolute inset-x-0 flex cursor-default hover:bg-[var(--hover)]"
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const key = cell.column.id
                    const column = table.columns.find((c) => c.key === key)
                    const raw = row.original.cells[key]
                    const target = row.original.sources[key]
                    const edited = target ? isFieldEdited(edits, target) : false
                    const open =
                      editing?.row === row.original.node && editing.column === key
                    const width = declaredWidth(schema, target?.attr)
                    // Valor acima da largura declarada aparece marcado sem
                    // precisar abrir o editor: numa carga inicial, é o que o
                    // sistema de destino vai recusar.
                    const overflowing =
                      width !== undefined && (raw?.length ?? 0) > width

                    return (
                      <td
                        key={cell.id}
                        onDoubleClick={(event) => {
                          if (!target) return
                          event.stopPropagation()
                          setEditing({ row: row.original.node, column: key })
                        }}
                        onClick={(event) => open && event.stopPropagation()}
                        title={
                          overflowing
                            ? `${raw?.length} caracteres — o arquivo declara largura ${width}`
                            : target
                              ? width !== undefined
                                ? `Duplo clique para editar (máx ${width})`
                                : 'Duplo clique para editar'
                              : undefined
                        }
                        className={cn(
                          'flex items-center overflow-hidden border-b border-[var(--hairline)]',
                          'min-w-32 flex-1 whitespace-nowrap',
                          open ? 'px-1' : 'px-3',
                          column?.numeric
                            ? 'num justify-end tabular-nums'
                            : 'font-mono text-[var(--fg-muted)]',
                          edited &&
                            !open &&
                            'border-l-2 border-l-changed bg-changed/[0.08] text-changed',
                          overflowing &&
                            !open &&
                            'border-l-2 border-l-removed bg-removed/[0.06] text-removed',
                        )}
                      >
                        {open && target ? (
                          <EditableField
                            autoFocus
                            className="w-full"
                            label={column?.label}
                            numeric={column?.numeric}
                            maxLength={declaredWidth(schema, target.attr)}
                            value={raw ?? ''}
                            original={originalValue(original, target) ?? ''}
                            edited={edited}
                            onCommit={(next) => onEdit(target, next)}
                            onRevert={() => onRevertField(target)}
                            onClose={() => setEditing(null)}
                          />
                        ) : raw === undefined ? (
                          <span className="text-[var(--fg-subtle)]">—</span>
                        ) : column?.numeric ? (
                          formatNumber(row.original.nums[key] ?? NaN)
                        ) : (
                          <Highlight text={raw} query={query} className="truncate" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {numericColumns.length > 0 && (
        <footer className="flex items-center gap-4 overflow-x-auto border-t border-[var(--hairline)] bg-[var(--surface)] px-4 py-2">
          <Eyebrow>Totais</Eyebrow>
          {numericColumns.slice(0, 8).map((column) => (
            <span key={column.key} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
                {column.label}
              </span>
              <span className="num text-[13px] font-semibold">
                {formatDecimal(columnTotal(table.rows, column.key))}
              </span>
            </span>
          ))}
        </footer>
      )}
    </div>
  )
}

function downloadCsv(
  table: ReturnType<typeof useNodeTable>['table'],
  fileName: string,
): void {
  // BOM para o Excel abrir acentuação corretamente.
  const blob = new Blob(['﻿' + toCsv(table)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName.replace(/\.xml$/i, '')}-${table.path.split('/').pop()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
