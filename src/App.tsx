import { useEffect, useMemo, useState } from 'react'
import {
  Columns2,
  Download,
  ListTree,
  PanelLeft,
  PanelRight,
  Search,
  Sigma,
  Table2,
  X,
} from 'lucide-react'
import {
  useActiveDoc,
  useDocEdits,
  useEffectiveDoc,
  useOriginalDoc,
  useWorkspace,
  type ViewMode,
} from './store/useWorkspace'
import { useSearchAndFilters } from './hooks/useXmlAnalysis'
import { useSaveDocument } from './hooks/useSaveDocument'
import { expandAll, expandToDepth } from './lib/xml/flatten'
import { countEdits } from './lib/xml/edits'
import { downloadXml } from './lib/download'
import { formatInt } from './lib/xml/coerce'
import { ChangesBar } from './components/edit/ChangesBar'
import { DropZone, FilePicker } from './components/upload/DropZone'
import { DocumentList } from './components/layout/DocumentList'
import { NodeInspector } from './components/layout/NodeInspector'
import { FilterPanel } from './components/filters/FilterPanel'
import { TreeView } from './components/tree/TreeView'
import { NodeTable } from './components/table/NodeTable'
import { DiffView } from './components/diff/DiffView'
import { MetricsPanel } from './components/metrics/MetricsPanel'
import { Button, IconButton, Segmented } from './components/ui/controls'
import { ToastHost } from './components/ui/Toast'
import { cn } from './lib/cn'

export default function App() {
  const store = useWorkspace()
  const doc = useActiveDoc()
  // O diff compara o que está na tela: se você editou um lado, a comparação
  // mostra a edição. É o que torna "editar e conferir" um fluxo só.
  const left = useEffectiveDoc(store.leftId)
  const right = useEffectiveDoc(store.rightId)
  const original = useOriginalDoc(store.activeId)
  const edits = useDocEdits(store.activeId)
  const editCount = useMemo(() => countEdits(edits), [edits])

  const { search, visible, fields, schema, query } = useSearchAndFilters(doc)
  const [inspectorTab, setInspectorTab] = useState<'metrics' | 'node'>('metrics')
  const { save, saving } = useSaveDocument()

  // A busca abre o caminho até cada ocorrência. Realçar um nó que está dentro
  // de um bloco fechado não ajuda ninguém.
  const { revealNodes } = store
  useEffect(() => {
    if (doc && search.reveal.size) revealNodes(doc.id, search.reveal)
  }, [doc, search.reveal, revealNodes])

  const expanded = useMemo(
    () =>
      doc ? (store.expanded[doc.id] ?? new Set<number>()) : new Set<number>(),
    [doc, store.expanded],
  )

  const comparing = store.view === 'diff'
  const hasDocs = store.docs.length > 0

  return (
    <DropZone onFiles={store.addFiles}>
      <div className="flex h-full flex-col bg-[var(--surface)]">
        <TopBar
          view={store.view}
          onViewChange={store.setView}
          canCompare={store.docs.length >= 2}
          query={store.query}
          onQueryChange={store.setQuery}
          hitCount={search.hits.length}
          truncated={search.truncated}
          sidebarOpen={store.sidebarOpen}
          inspectorOpen={store.inspectorOpen}
          onToggleSidebar={store.toggleSidebar}
          onToggleInspector={store.toggleInspector}
          onExport={doc ? () => downloadXml(doc) : undefined}
          exportLabel={doc ? `Baixar ${doc.fileName}` : undefined}
        />

        {store.failures.length > 0 && (
          <FailureBar failures={store.failures} onDismiss={store.clearFailures} />
        )}

        {doc && editCount > 0 && (
          <ChangesBar
            doc={doc}
            editCount={editCount}
            saving={saving}
            onRevertAll={() => store.revertDocument(doc.id)}
            onSave={() => void save(doc)}
          />
        )}

        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              'shrink-0 overflow-y-auto border-r border-[var(--hairline)] bg-[var(--surface-rail)] transition-[width]',
              store.sidebarOpen ? 'w-72' : 'w-0',
            )}
            aria-hidden={!store.sidebarOpen}
          >
            <div className="w-72">
              <DocumentList
                docs={store.docs}
                activeId={store.activeId}
                leftId={store.leftId}
                rightId={store.rightId}
                comparing={comparing}
                onSelect={store.setActive}
                onSetSide={store.setSide}
                onRemove={store.removeDoc}
                onFiles={store.addFiles}
              />
              {!comparing && (
                <FilterPanel
                  fields={fields}
                  schema={schema}
                  filters={store.filters}
                  matchCount={visible?.size}
                  onAdd={store.addFilter}
                  onUpdate={store.updateFilter}
                  onRemove={store.removeFilter}
                />
              )}
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col bg-[var(--surface)]">
            {!hasDocs ? (
              <Landing onFiles={store.addFiles} />
            ) : comparing ? (
              <DiffView left={left} right={right} />
            ) : store.view === 'table' ? (
              <NodeTable
                doc={doc}
                schema={schema}
                original={original}
                edits={edits}
                path={store.tablePath}
                scope={visible}
                query={query}
                onPathChange={store.setTablePath}
                onSelectNode={(id) => {
                  store.setSelected(id)
                  setInspectorTab('node')
                }}
                onEdit={(target, value) =>
                  doc && store.setField(doc.id, target, value)
                }
                onRevertField={(target) => doc && store.revertField(doc.id, target)}
              />
            ) : doc ? (
              <>
                <TreeToolbar
                  nodeCount={doc.nodes.length}
                  visibleCount={visible?.size}
                  onExpandAll={() => store.setExpanded(doc.id, expandAll(doc))}
                  onCollapse={() => store.setExpanded(doc.id, expandToDepth(doc, 1))}
                />
                <div className="min-h-0 flex-1">
                  <TreeView
                    doc={doc}
                    expanded={expanded}
                    visible={visible}
                    matched={search.matched}
                    query={query}
                    selected={store.selected}
                    edits={edits}
                    onToggle={(id) => store.toggleNode(doc.id, id)}
                    onSelect={(id) => {
                      store.setSelected(id)
                      setInspectorTab('node')
                    }}
                  />
                </div>
              </>
            ) : null}
          </main>

          <aside
            className={cn(
              'shrink-0 overflow-y-auto border-l border-[var(--hairline)] bg-[var(--surface-rail)] transition-[width]',
              store.inspectorOpen && !comparing ? 'w-80' : 'w-0',
            )}
            aria-hidden={!store.inspectorOpen || comparing}
          >
            <div className="w-80">
              <div className="border-b border-[var(--hairline)] p-3">
                <Segmented
                  value={inspectorTab}
                  onChange={setInspectorTab}
                  className="w-full"
                  options={[
                    { value: 'metrics', label: 'Totais', icon: <Sigma size={13} /> },
                    { value: 'node', label: 'Nó', icon: <ListTree size={13} /> },
                  ]}
                />
              </div>
              {doc &&
                (inspectorTab === 'metrics' ? (
                  <MetricsPanel
                    doc={doc}
                    fields={fields}
                    metricFieldId={store.metricFieldId}
                    groupFieldId={store.groupFieldId}
                    scope={visible}
                    onMetricChange={store.setMetricField}
                    onGroupChange={store.setGroupField}
                  />
                ) : (
                  <NodeInspector
                    doc={doc}
                    schema={schema}
                    original={original}
                    edits={edits}
                    nodeId={store.selected}
                    onEdit={(target, value) => store.setField(doc.id, target, value)}
                    onRevertField={(target) => store.revertField(doc.id, target)}
                    onRevertNode={(nodeId) => store.revertNode(doc.id, nodeId)}
                  />
                ))}
            </div>
          </aside>
        </div>

        <ToastHost />
      </div>
    </DropZone>
  )
}

/* ------------------------------------------------------------------ */

function TopBar({
  view,
  onViewChange,
  canCompare,
  query,
  onQueryChange,
  hitCount,
  truncated,
  sidebarOpen,
  inspectorOpen,
  onToggleSidebar,
  onToggleInspector,
  onExport,
  exportLabel,
}: {
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  canCompare: boolean
  query: string
  onQueryChange: (value: string) => void
  hitCount: number
  truncated: boolean
  sidebarOpen: boolean
  inspectorOpen: boolean
  onToggleSidebar: () => void
  onToggleInspector: () => void
  onExport?: () => void
  exportLabel?: string
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-3">
      <IconButton
        label={sidebarOpen ? 'Recolher painel esquerdo' : 'Abrir painel esquerdo'}
        onClick={onToggleSidebar}
        className={cn(sidebarOpen && 'text-brand-500')}
      >
        <PanelLeft size={16} />
      </IconButton>

      <span className="hidden items-baseline gap-1.5 sm:flex">
        <span className="font-display text-[15px] font-bold tracking-tight text-brand-500">
          Prisma
        </span>
        <span className="font-mono text-[11px] text-[var(--fg-muted)]">XML</span>
      </span>

      <div className="relative mx-auto w-full max-w-lg">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--fg-subtle)]"
        />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar em tags, valores e atributos…"
          aria-label="Busca global"
          className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-[var(--surface)] pr-24 pl-8 text-[13px] transition-colors placeholder:text-[var(--fg-subtle)] hover:border-brand-500 focus:border-brand-500"
        />
        {query && (
          <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
            <span className="num text-[11px] text-[var(--fg-muted)]">
              {formatInt(hitCount)}
              {truncated && '+'}
            </span>
            <IconButton
              label="Limpar busca"
              className="size-6"
              onClick={() => onQueryChange('')}
            >
              <X size={13} />
            </IconButton>
          </span>
        )}
      </div>

      <Segmented<ViewMode>
        value={view}
        onChange={onViewChange}
        options={[
          { value: 'tree', label: 'Árvore', icon: <ListTree size={13} /> },
          { value: 'table', label: 'Tabela', icon: <Table2 size={13} /> },
          ...(canCompare
            ? [
                {
                  value: 'diff' as const,
                  label: 'Comparar',
                  icon: <Columns2 size={13} />,
                },
              ]
            : []),
        ]}
      />

      <IconButton
        label={exportLabel ?? 'Baixar XML'}
        onClick={onExport}
        disabled={!onExport}
      >
        <Download size={16} />
      </IconButton>

      <IconButton
        label={inspectorOpen ? 'Recolher painel direito' : 'Abrir painel direito'}
        onClick={onToggleInspector}
        className={cn(inspectorOpen && 'text-brand-500')}
      >
        <PanelRight size={16} />
      </IconButton>
    </header>
  )
}

function TreeToolbar({
  nodeCount,
  visibleCount,
  onExpandAll,
  onCollapse,
}: {
  nodeCount: number
  visibleCount?: number
  onExpandAll: () => void
  onCollapse: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-4 py-2">
      <p className="text-[11.5px] text-[var(--fg-muted)]">
        <span className="num font-semibold text-[var(--fg)]">
          {formatInt(visibleCount ?? nodeCount)}
        </span>{' '}
        nós
        {visibleCount !== undefined && visibleCount !== nodeCount && (
          <> de {formatInt(nodeCount)}</>
        )}
      </p>
      <div className="ml-auto flex gap-1">
        <Button size="sm" onClick={onCollapse}>
          Recolher
        </Button>
        <Button size="sm" onClick={onExpandAll}>
          Expandir tudo
        </Button>
      </div>
    </div>
  )
}

function FailureBar({
  failures,
  onDismiss,
}: {
  failures: Array<{ fileName: string; message: string }>
  onDismiss: () => void
}) {
  return (
    <div className="flex items-start gap-3 border-b border-removed/40 bg-removed/10 px-4 py-2 text-[12.5px]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {failures.slice(0, 3).map((failure, i) => (
          <p key={i} className="truncate">
            <span className="font-mono font-medium text-removed">
              {failure.fileName}
            </span>{' '}
            <span className="text-[var(--fg-muted)]">{failure.message}</span>
          </p>
        ))}
        {failures.length > 3 && (
          <p className="text-[var(--fg-muted)]">
            e mais {failures.length - 3} arquivo(s).
          </p>
        )}
      </div>
      <IconButton label="Dispensar avisos" className="size-6" onClick={onDismiss}>
        <X size={13} />
      </IconButton>
    </div>
  )
}

function Landing({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-xl">
        {/* A régua de profundidade é o que dá identidade ao produto, então ela
            abre a tela em vez de um ícone genérico. */}
        <div className="mb-8 flex h-20 items-stretch gap-[3px]" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              className="w-px flex-none"
              style={{
                background: `var(--depth-${i % 6})`,
                opacity: 0.15 + 0.85 * Math.abs(Math.sin(i / 3.4)),
                marginTop: `${(i % 7) * 6}px`,
              }}
            />
          ))}
        </div>

        <h1 className="font-display text-[32px] leading-tight font-bold tracking-tight">
          Leia o XML pela forma,
          <br />
          não pelas chaves angulares.
        </h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[var(--fg-muted)]">
          Abra um ou mais arquivos para navegar a estrutura, filtrar registros,
          totalizar qualquer campo numérico e comparar duas versões. Nada sai do
          seu navegador.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <FilePicker onFiles={onFiles}>
            <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-[14px] font-medium text-white transition-colors hover:bg-brand-600">
              Abrir arquivos XML
            </span>
          </FilePicker>
          <span className="text-[12.5px] text-[var(--fg-muted)]">
            ou arraste para qualquer lugar da janela
          </span>
        </div>
      </div>
    </div>
  )
}
