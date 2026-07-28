import type {
  GroupedStats,
  PathProfile,
  Stats,
  XmlDocument,
  XmlField,
  XmlNode,
} from '../../types/xml'
import { toNumber } from './coerce'
import { isUnder, type DocumentSchema } from './schema'

export const EMPTY_STATS: Stats = {
  count: 0,
  sum: 0,
  avg: 0,
  min: 0,
  max: 0,
  invalid: 0,
}

/**
 * Agregação por campo, não por caminho.
 *
 * A versão anterior varria `node.path` e só enxergava texto de elemento. Em
 * XML tabular — DATAPACKET, ClientDataSet, exportação de ERP — o dado inteiro
 * está em atributo de `<ROW/>`, então aquele painel não achava nada para
 * somar. Aqui a leitura de valor é a mesma usada pelos filtros: atributo com
 * aquele nome, ou tag com aquele nome.
 */

/**
 * Caminhos que podem virar tabela.
 *
 * A regra "aparece mais de uma vez" sozinha erra em dois casos, e os dois são
 * comuns: um dataset com uma única linha não é reconhecido como tabela, e o
 * bloco de metadados do DATAPACKET — onde `<FIELD>` se repete uma vez por
 * coluna — é reconhecido como se fosse. O resultado era abrir um arquivo de um
 * lançamento e ver a grade de `attrname`/`fieldtype` no lugar do dado.
 *
 * Com o esquema em mãos a resposta é direta: a tabela é o que está sob a raiz
 * de dados, tenha uma linha ou dez mil.
 */
export function tableProfiles(
  doc: XmlDocument | undefined,
  schema: DocumentSchema,
): PathProfile[] {
  if (!doc) return []
  const profiles = Object.values(doc.profiles)

  if (schema.dataRoot) {
    const records = profiles.filter(
      (p) => isUnder(p.path, schema.dataRoot) && p.path !== schema.dataRoot,
    )
    // O registro principal é o mais raso; datasets aninhados vêm depois.
    if (records.length) {
      return records.sort((a, b) => a.depth - b.depth || b.count - a.count)
    }
  }

  const repeating = profiles
    .filter((p) => p.repeats && p.count > 1 && !isUnder(p.path, schema.metadataRoot))
    .sort((a, b) => b.count - a.count || a.depth - b.depth)
  if (repeating.length) return repeating

  // Nada se repete: em vez de negar a visão de tabela, oferece os caminhos com
  // cara de registro — os que têm ao menos dois campos folha. É o que salva um
  // documento legítimo com um único item.
  return profiles
    .filter((p) => !isUnder(p.path, schema.metadataRoot) && leafChildren(doc, p) >= 2)
    .sort((a, b) => b.count - a.count || b.depth - a.depth)
}

/** Quantos caminhos folha existem imediatamente abaixo deste. */
function leafChildren(doc: XmlDocument, profile: PathProfile): number {
  let count = 0
  for (const other of Object.values(doc.profiles)) {
    if (other.depth !== profile.depth + 1) continue
    if (!other.path.startsWith(profile.path + '/')) continue
    count++
  }
  return count
}

/** Valor cru do campo em um nó, seja atributo ou texto do elemento. */
function rawAt(node: XmlNode, field: XmlField): string | undefined {
  if (field.source === 'attribute') return node.attrs[field.name]
  return node.name === field.name ? node.value : undefined
}

/** Valor numérico do campo em um nó. */
function numAt(node: XmlNode, field: XmlField): number | undefined {
  if (field.source === 'element') {
    return node.name === field.name ? node.num : undefined
  }
  const raw = node.attrs[field.name]
  return raw === undefined ? undefined : toNumber(raw)
}

/** Soma, média, mínimo, máximo e contagem de um campo numérico. */
export function computeFieldStats(
  doc: XmlDocument | undefined,
  field: XmlField | undefined,
  scope?: Set<number> | null,
): Stats {
  if (!doc || !field) return EMPTY_STATS

  let count = 0
  let invalid = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity

  for (const node of doc.nodes) {
    if (scope && !scope.has(node.id)) continue
    const raw = rawAt(node, field)
    if (raw === undefined || raw === '') continue

    const value = numAt(node, field)
    if (value === undefined) {
      invalid++
      continue
    }
    count++
    sum += value
    if (value < min) min = value
    if (value > max) max = value
  }

  if (count === 0) return { ...EMPTY_STATS, invalid }
  return { count, sum, avg: sum / count, min, max, invalid }
}

/**
 * Totaliza um campo numérico quebrado por outro campo.
 *
 * A chave é resolvida assim: primeiro no próprio nó — em XML tabular valor e
 * chave são atributos da mesma `<ROW/>`, que é o caso comum e sai em O(1).
 * Se não estiver lá, sobe até o ancestral comum mais próximo entre os dois
 * campos e procura na subárvore dele. O ancestral comum é o que impede que o
 * item 1 pegue emprestada a descrição do item 2.
 */
export function computeFieldGrouped(
  doc: XmlDocument | undefined,
  valueField: XmlField | undefined,
  groupField: XmlField | undefined,
  scope?: Set<number> | null,
  limit = 200,
): GroupedStats[] {
  if (!doc || !valueField || !groupField) return []

  const anchorDepth = anchorDepthOf(valueField, groupField)
  const buckets = new Map<string, Stats>()
  let total = 0

  for (const node of doc.nodes) {
    if (scope && !scope.has(node.id)) continue
    const value = numAt(node, valueField)
    if (value === undefined) continue

    const key = resolveKey(doc, node.id, groupField, anchorDepth) ?? '(sem valor)'
    let bucket = buckets.get(key)
    if (!bucket) {
      buckets.set(key, (bucket = { ...EMPTY_STATS, min: Infinity, max: -Infinity }))
    }

    bucket.count++
    bucket.sum += value
    if (value < bucket.min) bucket.min = value
    if (value > bucket.max) bucket.max = value
    total += value
  }

  const rows: GroupedStats[] = []
  for (const [key, s] of buckets) {
    rows.push({
      key,
      count: s.count,
      sum: s.sum,
      avg: s.sum / s.count,
      min: s.min,
      max: s.max,
      invalid: 0,
      share: total === 0 ? 0 : s.sum / total,
    })
  }

  rows.sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum))
  return rows.slice(0, limit)
}

function resolveKey(
  doc: XmlDocument,
  valueNode: number,
  groupField: XmlField,
  anchorDepth: number,
): string | undefined {
  const own = rawAt(doc.nodes[valueNode], groupField)
  if (own !== undefined) return own

  let anchor = valueNode
  while (anchor >= 0 && doc.nodes[anchor].depth > anchorDepth) {
    anchor = doc.nodes[anchor].parent
  }
  if (anchor < 0) return undefined

  return searchSubtree(doc, anchor, groupField)
}

/** Busca em largura pelo campo, com orçamento para não varrer o documento. */
function searchSubtree(
  doc: XmlDocument,
  root: number,
  field: XmlField,
  budget = 4000,
): string | undefined {
  const own = rawAt(doc.nodes[root], field)
  if (own !== undefined) return own

  const queue = [...doc.nodes[root].children]
  let seen = 0
  while (queue.length && seen++ < budget) {
    const node = doc.nodes[queue.shift()!]
    const hit = rawAt(node, field)
    if (hit !== undefined) return hit
    for (const child of node.children) queue.push(child)
  }
  return undefined
}

/**
 * Profundidade do ancestral comum mais próximo entre os dois campos. Como um
 * campo pode ocorrer em vários caminhos, vale o par mais próximo.
 */
function anchorDepthOf(valueField: XmlField, groupField: XmlField): number {
  let best = 0
  for (const a of valueField.paths) {
    for (const b of groupField.paths) {
      const common = commonSegments(a, b)
      if (common > best) best = common
    }
  }
  return best - 1
}

/** Quantos segmentos os dois caminhos compartilham a partir da raiz. */
function commonSegments(a: string, b: string): number {
  const left = a.split('/')
  const right = b.split('/')
  let i = 0
  while (i < left.length && i < right.length && left[i] === right[i]) i++
  return i - 1
}

/**
 * Campos que fazem sentido como chave para um dado campo de valor: qualquer
 * outro campo que compartilhe ao menos um ancestral com ele.
 */
export function groupCandidates(
  fields: XmlField[],
  valueField: XmlField | undefined,
): XmlField[] {
  if (!valueField) return []
  return fields.filter(
    (field) => field.id !== valueField.id && anchorDepthOf(valueField, field) >= 0,
  )
}
