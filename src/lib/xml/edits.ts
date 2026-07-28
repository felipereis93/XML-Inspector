import type {
  DocumentEdits,
  EditTarget,
  NodeEdit,
  XmlDocument,
} from '../../types/xml'
import { toNumber, toTime } from './coerce'

/**
 * Camada de edição.
 *
 * Nada aqui muta o documento. `applyEdits` produz um documento efetivo novo a
 * partir do original mais o overlay, e é esse documento que toda a aplicação
 * consome — árvore, tabela, busca, filtros, totais e exportação. Assim editar
 * um valor atualiza a soma no painel de totais sem nenhuma sincronização
 * manual, e reverter volta ao estado exato de origem.
 */

/** Valor atualmente em vigor para um campo: o editado, senão o original. */
export function effectiveValue(
  doc: XmlDocument | undefined,
  edits: DocumentEdits | undefined,
  target: EditTarget,
): string | undefined {
  const node = doc?.nodes[target.node]
  if (!node) return undefined
  const edit = edits?.[target.node]

  if (target.attr === undefined) {
    return edit?.value !== undefined ? edit.value : node.value
  }
  const edited = edit?.attrs?.[target.attr]
  return edited !== undefined ? edited : node.attrs[target.attr]
}

/** Valor do documento original, para comparação e para o "desfazer". */
export function originalValue(
  doc: XmlDocument | undefined,
  target: EditTarget,
): string | undefined {
  const node = doc?.nodes[target.node]
  if (!node) return undefined
  return target.attr === undefined ? node.value : node.attrs[target.attr]
}

export function isFieldEdited(
  edits: DocumentEdits | undefined,
  target: EditTarget,
): boolean {
  const edit = edits?.[target.node]
  if (!edit) return false
  return target.attr === undefined
    ? edit.value !== undefined
    : edit.attrs?.[target.attr] !== undefined
}

export function isNodeEdited(
  edits: DocumentEdits | undefined,
  nodeId: number,
): boolean {
  return edits?.[nodeId] !== undefined
}

/** Quantos campos foram alterados no documento inteiro. */
export function countEdits(edits: DocumentEdits | undefined): number {
  if (!edits) return 0
  let total = 0
  for (const key in edits) {
    const edit = edits[key]
    if (edit.value !== undefined) total++
    if (edit.attrs) total += Object.keys(edit.attrs).length
  }
  return total
}

/**
 * Grava um valor no overlay.
 *
 * Se o novo valor for igual ao original, a entrada é removida em vez de
 * gravada. Digitar algo e depois digitar de volta o valor de origem não deixa
 * o campo marcado como alterado, e o contador não mente.
 */
export function writeEdit(
  edits: DocumentEdits,
  doc: XmlDocument,
  target: EditTarget,
  next: string,
): DocumentEdits {
  const original = originalValue(doc, target) ?? ''
  const revert = next === original

  const current = edits[target.node]
  const draft: NodeEdit = {
    value: current?.value,
    attrs: current?.attrs ? { ...current.attrs } : undefined,
  }

  if (target.attr === undefined) {
    if (revert) draft.value = undefined
    else draft.value = next
  } else {
    const attrs = draft.attrs ?? {}
    if (revert) delete attrs[target.attr]
    else attrs[target.attr] = next
    draft.attrs = Object.keys(attrs).length > 0 ? attrs : undefined
  }

  const out = { ...edits }
  if (draft.value === undefined && draft.attrs === undefined) delete out[target.node]
  else out[target.node] = draft
  return out
}

/** Remove a edição de um campo. */
export function clearEdit(
  edits: DocumentEdits,
  target: EditTarget,
): DocumentEdits {
  const current = edits[target.node]
  if (!current) return edits

  const draft: NodeEdit = {
    value: current.value,
    attrs: current.attrs ? { ...current.attrs } : undefined,
  }

  if (target.attr === undefined) draft.value = undefined
  else if (draft.attrs) {
    delete draft.attrs[target.attr]
    if (Object.keys(draft.attrs).length === 0) draft.attrs = undefined
  }

  const out = { ...edits }
  if (draft.value === undefined && draft.attrs === undefined) delete out[target.node]
  else out[target.node] = draft
  return out
}

/** Remove todas as edições de um nó. */
export function clearNodeEdits(
  edits: DocumentEdits,
  nodeId: number,
): DocumentEdits {
  if (!edits[nodeId]) return edits
  const out = { ...edits }
  delete out[nodeId]
  return out
}

/**
 * Documento original + overlay.
 *
 * O array de nós é copiado por referência (`slice`) e só os nós editados
 * ganham objeto novo — copiar 200 mil ponteiros custa cerca de um milissegundo
 * e o resto da árvore continua compartilhado. Os campos derivados `num` e
 * `time` são recalculados nos nós tocados, senão um valor recém-editado
 * entraria nos totais com o número antigo.
 */
export function applyEdits(
  doc: XmlDocument | undefined,
  edits: DocumentEdits | undefined,
): XmlDocument | undefined {
  if (!doc || !edits) return doc
  const ids = Object.keys(edits)
  if (ids.length === 0) return doc

  const nodes = doc.nodes.slice()

  for (const key of ids) {
    const id = Number(key)
    const base = doc.nodes[id]
    if (!base) continue
    const edit = edits[id]

    const attrs = edit.attrs ? { ...base.attrs, ...edit.attrs } : base.attrs
    const value = edit.value !== undefined ? edit.value : base.value
    const num = value === undefined ? undefined : toNumber(value)
    const time = num !== undefined || value === undefined ? undefined : toTime(value)

    nodes[id] = { ...base, attrs, value, num, time }
  }

  // Os perfis de caminho não são recalculados: eles alimentam sugestões de
  // faixa e detecção de tipo, e refazê-los a cada edição custaria uma passagem
  // completa para mudar um placeholder. Totais e filtros leem os nós, que já
  // estão atualizados.
  return { ...doc, nodes }
}
