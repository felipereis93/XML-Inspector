import { useMemo } from 'react'
import { create } from 'zustand'
import type {
  DocumentEdits,
  EditTarget,
  Filter,
  ParseFailure,
  XmlDocument,
} from '../types/xml'
import { parseFile } from '../lib/parsePool'
import { expandToDepth } from '../lib/xml/flatten'
import {
  applyEdits,
  clearEdit,
  clearNodeEdits,
  writeEdit,
} from '../lib/xml/edits'
import { commitEdits, remainingEdits } from '../lib/xml/commit'
import { forgetHandle, rememberHandle } from '../lib/fs/handles'
import type { HandleMap } from '../lib/fs/pickFiles'

export type ViewMode = 'tree' | 'table' | 'diff'

interface WorkspaceState {
  docs: XmlDocument[]
  failures: ParseFailure[]
  loading: string[]

  activeId?: string
  leftId?: string
  rightId?: string

  view: ViewMode
  query: string
  filters: Filter[]

  /** Nós abertos, por documento. */
  expanded: Record<string, Set<number>>
  /** Nó em foco no inspetor. */
  selected?: number
  /** Alterações pendentes, por documento. O original nunca é tocado. */
  edits: Record<string, DocumentEdits>

  /** Id do campo totalizado e do campo usado como chave de agrupamento. */
  metricFieldId?: string
  groupFieldId?: string
  tablePath?: string

  sidebarOpen: boolean
  inspectorOpen: boolean

  addFiles: (files: File[], handles?: HandleMap) => Promise<void>
  removeDoc: (id: string) => void
  clearFailures: () => void

  setActive: (id: string) => void
  setSide: (side: 'left' | 'right', id: string) => void
  setView: (view: ViewMode) => void
  setQuery: (query: string) => void

  setFilters: (filters: Filter[]) => void
  addFilter: (filter: Filter) => void
  updateFilter: (id: string, patch: Partial<Filter>) => void
  removeFilter: (id: string) => void

  setField: (docId: string, target: EditTarget, value: string) => void
  revertField: (docId: string, target: EditTarget) => void
  revertNode: (docId: string, nodeId: number) => void
  revertDocument: (docId: string) => void
  /**
   * Gravação confirmada: as edições viram o novo baseline.
   *
   * `committed` é o overlay que foi realmente serializado — capturado antes da
   * escrita, não relido agora. `fileName` vem do handle gravado, para o caso do
   * "Salvar como".
   */
  commitDocument: (
    docId: string,
    bytes: number,
    committed: DocumentEdits | undefined,
    fileName?: string,
  ) => void

  setSelected: (nodeId?: number) => void
  setExpanded: (docId: string, expanded: Set<number>) => void
  toggleNode: (docId: string, nodeId: number) => void
  revealNodes: (docId: string, ids: Iterable<number>) => void

  setMetricField: (fieldId?: string) => void
  setGroupField: (fieldId?: string) => void
  setTablePath: (path?: string) => void

  toggleSidebar: () => void
  toggleInspector: () => void
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  docs: [],
  failures: [],
  loading: [],
  view: 'tree',
  query: '',
  filters: [],
  expanded: {},
  edits: {},
  sidebarOpen: true,
  inspectorOpen: true,

  addFiles: async (files, handles) => {
    const xml = files.filter((f) => /\.(xml|nfe|xsd|svg|rss|kml)$/i.test(f.name))
    const rejected = files.filter((f) => !xml.includes(f))

    if (rejected.length) {
      set((s) => ({
        failures: [
          ...s.failures,
          ...rejected.map((f) => ({
            fileName: f.name,
            message: 'Formato não suportado. Envie um arquivo .xml.',
          })),
        ],
      }))
    }
    if (!xml.length) return

    set((s) => ({ loading: [...s.loading, ...xml.map((f) => f.name)] }))

    const results = await Promise.allSettled(xml.map(parseFile))
    const parsed: XmlDocument[] = []
    const failures: ParseFailure[] = []

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        parsed.push(result.value)
        const handle = handles?.get(xml[i])
        if (handle) rememberHandle(result.value.id, handle)
      } else {
        const reason = result.reason as ParseFailure | Error
        failures.push({
          fileName: xml[i].name,
          message:
            'message' in reason ? reason.message : 'Não foi possível ler o arquivo.',
        })
      }
    })

    set((s) => {
      const docs = [...s.docs, ...parsed]
      const expanded = { ...s.expanded }
      for (const doc of parsed) expanded[doc.id] = expandToDepth(doc, 2)

      const activeId = s.activeId ?? parsed[0]?.id
      const leftId = s.leftId ?? docs[0]?.id
      const rightId = s.rightId ?? docs.find((d) => d.id !== leftId)?.id

      return {
        docs,
        expanded,
        activeId,
        leftId,
        rightId,
        failures: [...s.failures, ...failures],
        loading: s.loading.filter((name) => !xml.some((f) => f.name === name)),
      }
    })
  },

  removeDoc: (id) =>
    set((s) => {
      // Fechar o arquivo e reabrir depois deve pedir o handle de novo — manter
      // o antigo apontaria para um documento que não está mais na tela.
      forgetHandle(id)
      const docs = s.docs.filter((d) => d.id !== id)
      const expanded = { ...s.expanded }
      const edits = { ...s.edits }
      delete expanded[id]
      delete edits[id]
      const fallback = docs[0]?.id
      return {
        docs,
        expanded,
        edits,
        activeId: s.activeId === id ? fallback : s.activeId,
        leftId: s.leftId === id ? fallback : s.leftId,
        rightId:
          s.rightId === id ? docs.find((d) => d.id !== s.leftId)?.id : s.rightId,
      }
    }),

  clearFailures: () => set({ failures: [] }),

  // Caminhos e nó selecionado são específicos de um documento: mantê-los ao
  // trocar de arquivo produziria um painel de totais apontando para o nada.
  setActive: (activeId) =>
    set({
      activeId,
      metricFieldId: undefined,
      groupFieldId: undefined,
      tablePath: undefined,
      selected: undefined,
    }),
  setSide: (side, id) => set(side === 'left' ? { leftId: id } : { rightId: id }),
  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),

  setFilters: (filters) => set({ filters }),
  addFilter: (filter) => set((s) => ({ filters: [...s.filters, filter] })),
  updateFilter: (id, patch) =>
    set((s) => ({
      filters: s.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),
  removeFilter: (id) =>
    set((s) => ({ filters: s.filters.filter((f) => f.id !== id) })),

  setField: (docId, target, value) =>
    set((s) => {
      const doc = s.docs.find((d) => d.id === docId)
      if (!doc) return s
      const next = writeEdit(s.edits[docId] ?? {}, doc, target, value)
      return { edits: { ...s.edits, [docId]: next } }
    }),

  revertField: (docId, target) =>
    set((s) => ({
      edits: { ...s.edits, [docId]: clearEdit(s.edits[docId] ?? {}, target) },
    })),

  revertNode: (docId, nodeId) =>
    set((s) => ({
      edits: {
        ...s.edits,
        [docId]: clearNodeEdits(s.edits[docId] ?? {}, nodeId),
      },
    })),

  revertDocument: (docId) =>
    set((s) => {
      const edits = { ...s.edits }
      delete edits[docId]
      return { edits }
    }),

  commitDocument: (docId, bytes, committed, fileName) =>
    set((s) => {
      const doc = s.docs.find((d) => d.id === docId)
      if (!doc) return s

      const saved = commitEdits(doc, committed, bytes, fileName)

      // Só o que foi gravado sai do overlay. Uma edição feita durante a
      // escrita continua pendente — ela não está no arquivo.
      const rest = remainingEdits(s.edits[docId] ?? {}, committed)
      const edits = { ...s.edits }
      if (Object.keys(rest).length > 0) edits[docId] = rest
      else delete edits[docId]

      return {
        docs: s.docs.map((d) => (d.id === docId ? saved : d)),
        edits,
      }
    }),

  setSelected: (selected) => set({ selected }),

  setExpanded: (docId, next) =>
    set((s) => ({ expanded: { ...s.expanded, [docId]: next } })),

  toggleNode: (docId, nodeId) =>
    set((s) => {
      const next = new Set(s.expanded[docId] ?? [])
      if (!next.delete(nodeId)) next.add(nodeId)
      return { expanded: { ...s.expanded, [docId]: next } }
    }),

  revealNodes: (docId, ids) =>
    set((s) => {
      const next = new Set(s.expanded[docId] ?? [])
      for (const id of ids) next.add(id)
      return { expanded: { ...s.expanded, [docId]: next } }
    }),

  // Trocar o campo totalizado invalida a chave: agrupar por um campo de outro
  // ramo da árvore não produziria nada além de "(sem valor)".
  setMetricField: (metricFieldId) =>
    set({ metricFieldId, groupFieldId: undefined }),
  setGroupField: (groupFieldId) => set({ groupFieldId }),
  setTablePath: (tablePath) => set({ tablePath }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
}))

/**
 * Documento com as edições aplicadas.
 *
 * Toda a interface consome esta versão, nunca a original: assim uma alteração
 * de valor atravessa árvore, tabela, busca, filtros, totais e exportação sem
 * nenhum ponto de sincronização manual. O original fica guardado em `docs`,
 * que é o que torna "desfazer" e o rótulo de "alterado" possíveis.
 */
export function useEffectiveDoc(id?: string): XmlDocument | undefined {
  const doc = useWorkspace((s) => s.docs.find((d) => d.id === id))
  const edits = useWorkspace((s) => (id ? s.edits[id] : undefined))
  return useMemo(() => applyEdits(doc, edits), [doc, edits])
}

export function useActiveDoc(): XmlDocument | undefined {
  const activeId = useWorkspace((s) => s.activeId)
  return useEffectiveDoc(activeId)
}

/** Documento original, sem edições — para comparar e para reverter. */
export function useOriginalDoc(id?: string): XmlDocument | undefined {
  return useWorkspace((s) => s.docs.find((d) => d.id === id))
}

export function useDocEdits(id?: string): DocumentEdits | undefined {
  return useWorkspace((s) => (id ? s.edits[id] : undefined))
}

/** Sai da store para evitar `get()` dentro de componentes. */
export const workspace = useWorkspace.getState
