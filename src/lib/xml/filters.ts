import type { Filter, XmlDocument, XmlNode } from '../../types/xml'
import { toNumber, toTime } from './coerce'

/**
 * Filtros por nome de campo, com OU em dois níveis.
 *
 * Dentro de um filtro, vários valores valem como `IN`: o registro passa se o
 * campo casar com qualquer um deles. Entre filtros, os que dividem o mesmo
 * `group` são unidos por OU e os grupos são cruzados por E — a precedência
 * fica `(A OU B) E (C OU D)`, visível na tela e sem depender de ordem.
 *
 * O filtro guarda só o nome do campo (`ECTCE_Codigo`), nunca o caminho. Casar
 * por nome é o que permite escolher o campo direto no primeiro dropdown: a
 * busca varre os nós e, para cada um, olha se ele tem um atributo com aquele
 * nome ou se ele próprio é uma tag com aquele nome. Em XML tabular
 * (`<ROW ECTCE_Codigo="…"/>`) isso encontra as `ROW` sem que ninguém precise
 * saber que elas se chamam `ROW`.
 *
 * Um filtro seleciona nós, mas o usuário quer ver registros. Por isso cada
 * filtro é expandido para o fecho ancestrais + descendentes dos nós que
 * casaram — filtrar por `vProd entre 100 e 500` deixa o item inteiro visível,
 * não a tag solta.
 */
export function applyFilters(
  doc: XmlDocument | undefined,
  filters: Filter[],
): Set<number> | null {
  if (!doc) return null
  const active = filters.filter((f) => f.enabled && isComplete(f))
  if (active.length === 0) return null

  let visible: Set<number> | null = null

  for (const group of groupsOf(active)) {
    // OU dentro do grupo: a união dos fechos.
    let union: Set<number> | null = null
    for (const filter of group) {
      const closure = closureOf(doc, matchNodes(doc, filter))
      if (union === null) union = closure
      else for (const id of closure) union.add(id)
    }
    if (!union) continue

    // E entre grupos: interseção com o que já sobrou.
    visible = visible === null ? union : intersect(visible, union)
    if (visible.size === 0) break
  }

  return visible
}

/** Agrupa preservando a ordem de primeira aparição de cada grupo. */
function groupsOf(filters: Filter[]): Filter[][] {
  const byGroup = new Map<string, Filter[]>()
  for (const filter of filters) {
    const bucket = byGroup.get(filter.group)
    if (bucket) bucket.push(filter)
    else byGroup.set(filter.group, [filter])
  }
  return [...byGroup.values()]
}

/** Um filtro sem campo ou sem termo não restringe nada e é ignorado. */
export function isComplete(filter: Filter): boolean {
  if (!filter.field) return false
  switch (filter.op) {
    case 'exists':
      return true
    case 'between':
      return filter.min !== undefined || filter.max !== undefined
    case 'gt':
    case 'gte':
      return filter.min !== undefined
    case 'lt':
    case 'lte':
      return filter.max !== undefined
    default:
      return filter.values.some((v) => v.trim() !== '')
  }
}

/* ------------------------------------------------------------------ */
/* Compilação                                                          */
/* ------------------------------------------------------------------ */

/**
 * Forma pré-processada de um filtro.
 *
 * As strings são normalizadas uma vez por filtro, não uma vez por nó. Em um
 * arquivo de 200 mil nós isso é a diferença entre 200 mil `toLowerCase()` por
 * valor e um punhado; e `equals` vira consulta a `Set`, que responde em O(1)
 * independentemente de quantos valores o usuário digitou.
 */
interface CompiledFilter {
  field: string
  checkAttr: boolean
  checkElement: boolean
  op: Filter['op']
  kind: Filter['kind']
  /** Valores em minúsculas para `equals` — teste de pertinência direto. */
  exact?: Set<string>
  /** Valores em minúsculas para `contains` e `starts`. */
  needles?: string[]
  min?: number
  max?: number
}

function compile(filter: Filter): CompiledFilter {
  const compiled: CompiledFilter = {
    field: filter.field,
    checkAttr: filter.source !== 'element',
    checkElement: filter.source !== 'attribute',
    op: filter.op,
    kind: filter.kind,
    min: filter.min,
    max: filter.max,
  }

  const values = filter.values
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== '')

  if (filter.op === 'equals') compiled.exact = new Set(values)
  else if (filter.op === 'contains' || filter.op === 'starts') {
    compiled.needles = values
  }

  return compiled
}

/**
 * Nós que satisfazem o filtro. Percorre o array plano uma vez; o custo é
 * O(nós) por filtro, sem índice auxiliar para manter sincronizado.
 */
function matchNodes(doc: XmlDocument, filter: Filter): number[] {
  const compiled = compile(filter)
  const out: number[] = []

  for (const node of doc.nodes) {
    if (compiled.checkAttr) {
      const raw = node.attrs[compiled.field]
      if (raw !== undefined && matches(compiled, raw)) {
        out.push(node.id)
        continue
      }
    }
    if (compiled.checkElement && node.name === compiled.field) {
      if (matches(compiled, node.value, node)) out.push(node.id)
    }
  }

  return out
}

/**
 * Compara um valor com o filtro compilado. `node` só é passado quando o valor
 * vem do texto de um elemento, que já foi coagido no parsing; valores de
 * atributo são convertidos aqui, e só para os operadores que pedem número.
 */
function matches(
  filter: CompiledFilter,
  raw: string | undefined,
  node?: XmlNode,
): boolean {
  if (filter.op === 'exists') return raw !== undefined && raw.trim() !== ''
  if (raw === undefined) return false

  switch (filter.op) {
    case 'between':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const scalar = scalarOf(filter, raw, node)
      if (scalar === undefined) return false
      if (filter.op === 'gt') return scalar > filter.min!
      if (filter.op === 'gte') return scalar >= filter.min!
      if (filter.op === 'lt') return scalar < filter.max!
      if (filter.op === 'lte') return scalar <= filter.max!
      if (filter.min !== undefined && scalar < filter.min) return false
      if (filter.max !== undefined && scalar > filter.max) return false
      return true
    }

    case 'equals':
      return filter.exact!.has(raw.trim().toLowerCase())

    default: {
      const haystack = raw.toLowerCase()
      const needles = filter.needles!
      // OU entre os valores: basta um casar.
      for (const needle of needles) {
        if (
          filter.op === 'starts'
            ? haystack.startsWith(needle)
            : haystack.includes(needle)
        ) {
          return true
        }
      }
      return false
    }
  }
}

function scalarOf(
  filter: CompiledFilter,
  raw: string,
  node?: XmlNode,
): number | undefined {
  if (filter.kind === 'date') return node?.time ?? toTime(raw)
  return node?.num ?? toNumber(raw)
}

/* ------------------------------------------------------------------ */
/* Conjuntos                                                           */
/* ------------------------------------------------------------------ */

/** Nós que casaram + seus ancestrais + suas subárvores. */
function closureOf(doc: XmlDocument, seeds: number[]): Set<number> {
  const out = new Set<number>()
  const queue: number[] = []

  for (const id of seeds) {
    if (out.has(id)) continue
    out.add(id)
    queue.push(id)
    let parent = doc.nodes[id].parent
    while (parent >= 0 && !out.has(parent)) {
      out.add(parent)
      parent = doc.nodes[parent].parent
    }
  }

  while (queue.length) {
    const node = doc.nodes[queue.pop()!]
    for (const child of node.children) {
      if (out.has(child)) continue
      out.add(child)
      queue.push(child)
    }
  }

  return out
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  const out = new Set<number>()
  for (const id of small) if (large.has(id)) out.add(id)
  return out
}

/* ------------------------------------------------------------------ */
/* Construção                                                          */
/* ------------------------------------------------------------------ */

/** Sem `group`, o filtro nasce em um grupo novo — ou seja, ligado por E. */
export function emptyFilter(group: string = crypto.randomUUID()): Filter {
  return {
    id: crypto.randomUUID(),
    group,
    field: '',
    source: 'any',
    op: 'contains',
    values: [],
    kind: 'text',
    enabled: true,
  }
}

/** Operadores que aceitam mais de um valor. */
export function acceptsMultiple(op: Filter['op']): boolean {
  return op === 'equals' || op === 'contains' || op === 'starts'
}

/**
 * Quebra texto colado em valores. Aceita vírgula, ponto e vírgula, tabulação e
 * quebra de linha — é o que sai de uma coluna copiada de planilha.
 */
export function splitValues(raw: string): string[] {
  return raw
    .split(/[,;\t\r\n]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '')
}
