import { useMemo } from 'react'
import type { XmlDocument, XmlField } from '../types/xml'
import { applyFilters } from '../lib/xml/filters'
import { searchDocument } from '../lib/xml/search'
import { buildFieldIndex, findFieldById, numericFields } from '../lib/xml/fields'
import { detectSchema } from '../lib/xml/schema'
import {
  computeFieldGrouped,
  computeFieldStats,
  groupCandidates,
  tableProfiles,
} from '../lib/xml/stats'
import type { DocumentSchema } from '../lib/xml/schema'
import { diffDocuments } from '../lib/xml/diff'
import { buildTable } from '../lib/xml/table'
import { useDebounced } from './useDebounced'
import { useWorkspace } from '../store/useWorkspace'

/**
 * Busca + filtros + índice de campos do documento ativo.
 *
 * Busca e filtro são intencionalmente separados: a busca realça sem esconder
 * nada, o filtro esconde. Misturar os dois é o que faz visualizadores de XML
 * "perderem" nós que o usuário sabe que existem.
 */
export function useSearchAndFilters(doc: XmlDocument | undefined) {
  const query = useWorkspace((s) => s.query)
  const filters = useWorkspace((s) => s.filters)
  const debouncedQuery = useDebounced(query, 180)

  const search = useMemo(
    () => searchDocument(doc, debouncedQuery),
    [doc, debouncedQuery],
  )

  const visible = useMemo(() => applyFilters(doc, filters), [doc, filters])

  // O esquema declarado pelo próprio arquivo, quando existir, decide o que é
  // coluna de dado e o que é vocabulário do formato.
  const schema = useMemo(() => detectSchema(doc), [doc])
  const fields = useMemo(() => buildFieldIndex(doc, schema), [doc, schema])

  return { search, visible, fields, schema, query: debouncedQuery }
}

/** Métricas do campo numérico selecionado, com e sem quebra por chave. */
export function useAggregation(
  doc: XmlDocument | undefined,
  fields: XmlField[],
  valueFieldId: string | undefined,
  groupFieldId: string | undefined,
  scope: Set<number> | null,
) {
  const numeric = useMemo(() => numericFields(fields), [fields])
  const valueField = useMemo(
    () => findFieldById(fields, valueFieldId),
    [fields, valueFieldId],
  )
  const groupField = useMemo(
    () => findFieldById(fields, groupFieldId),
    [fields, groupFieldId],
  )

  const stats = useMemo(
    () => computeFieldStats(doc, valueField, scope),
    [doc, valueField, scope],
  )
  const candidates = useMemo(
    () => groupCandidates(fields, valueField),
    [fields, valueField],
  )
  const grouped = useMemo(
    () => computeFieldGrouped(doc, valueField, groupField, scope),
    [doc, valueField, groupField, scope],
  )

  return { numeric, valueField, groupField, stats, candidates, grouped }
}

/** Tabela dinâmica do caminho repetido selecionado. */
export function useNodeTable(
  doc: XmlDocument | undefined,
  schema: DocumentSchema,
  path: string | undefined,
  scope: Set<number> | null,
) {
  const repeating = useMemo(() => tableProfiles(doc, schema), [doc, schema])
  const resolved = path ?? repeating[0]?.path
  const table = useMemo(
    () => buildTable(doc, resolved ?? '', scope),
    [doc, resolved, scope],
  )
  return { repeating, table, resolvedPath: resolved }
}

/** Comparação estrutural entre dois documentos. */
export function useXmlDiff(
  left: XmlDocument | undefined,
  right: XmlDocument | undefined,
) {
  return useMemo(() => diffDocuments(left, right), [left, right])
}
