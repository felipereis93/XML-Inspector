import type {
  AttrChange,
  DiffRow,
  DiffStatus,
  DiffSummary,
  XmlDocument,
  XmlNode,
} from '../../types/xml'

/**
 * Diff estrutural, não textual.
 *
 * Comparar XML como linhas de texto reporta ruído: reindentar o arquivo ou
 * reordenar dois atributos vira "arquivo inteiro alterado". Aqui a comparação
 * é feita sobre a árvore, então reindentação é invisível e uma alteração de
 * atributo é reportada no atributo, não na linha.
 *
 * Pareamento: filhos são casados por uma chave de identidade — nome da tag mais
 * o valor de um atributo identificador (`id`, `nItem`, `codigo`, ...) quando
 * existir, senão a posição entre irmãos de mesmo nome. Chaves repetidas são
 * desempatadas por ordem de ocorrência, o que torna o pareamento uma bijeção e
 * o algoritmo linear no número de nós.
 */

const IDENTITY_ATTRS = [
  'id',
  'Id',
  'ID',
  'key',
  'nItem',
  'numero',
  'num',
  'codigo',
  'code',
  'cod',
  'chave',
  'ref',
  'name',
]

export interface DiffResult {
  rows: DiffRow[]
  summary: DiffSummary
  /** Verdadeiro quando nada mudou entre os dois documentos. */
  identical: boolean
}

export function diffDocuments(
  left: XmlDocument | undefined,
  right: XmlDocument | undefined,
): DiffResult {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0, equal: 0 }
  if (!left || !right) return { rows: [], summary, identical: true }

  const ctx: Ctx = { left, right, summary, nextId: 0 }
  const rows = diffLists(ctx, [left.root], [right.root], 0)
  return {
    rows,
    summary,
    identical: summary.added + summary.removed + summary.changed === 0,
  }
}

interface Ctx {
  left: XmlDocument
  right: XmlDocument
  summary: DiffSummary
  nextId: number
}

/** Casa duas listas de irmãos e devolve as linhas na ordem mesclada. */
function diffLists(
  ctx: Ctx,
  leftIds: number[],
  rightIds: number[],
  depth: number,
): DiffRow[] {
  const leftKeys = keysOf(ctx.left, leftIds)
  const rightKeys = keysOf(ctx.right, rightIds)

  const rightByKey = new Map<string, number>()
  rightKeys.forEach((key, i) => rightByKey.set(key, i))

  /** índice na esquerda -> índice na direita */
  const pairs = new Map<number, number>()
  const matchedRight = new Set<number>()
  leftKeys.forEach((key, i) => {
    const j = rightByKey.get(key)
    if (j !== undefined && !matchedRight.has(j)) {
      pairs.set(i, j)
      matchedRight.add(j)
    }
  })

  const rows: DiffRow[] = []
  let rightCursor = 0

  const flushRightUpTo = (limit: number) => {
    while (rightCursor < limit) {
      if (!matchedRight.has(rightCursor)) {
        rows.push(sideRow(ctx, ctx.right, rightIds[rightCursor], 'added', depth))
      }
      rightCursor++
    }
  }

  for (let i = 0; i < leftIds.length; i++) {
    const j = pairs.get(i)
    if (j === undefined) {
      rows.push(sideRow(ctx, ctx.left, leftIds[i], 'removed', depth))
      continue
    }
    // Tudo que só existe na direita e vem antes do par entra aqui, para que a
    // ordem lida na tela seja a ordem do documento da direita.
    flushRightUpTo(j)
    rows.push(pairRow(ctx, leftIds[i], rightIds[j], depth))
    rightCursor = j + 1
  }
  flushRightUpTo(rightIds.length)

  markLast(rows)
  return rows
}

function keysOf(doc: XmlDocument, ids: number[]): string[] {
  const used = new Map<string, number>()
  return ids.map((id) => {
    const node = doc.nodes[id]
    const base = `${node.name}#${identityOf(node) ?? node.ordinal}`
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}~${seen}`
  })
}

function identityOf(node: XmlNode): string | undefined {
  for (const attr of IDENTITY_ATTRS) {
    const value = node.attrs[attr]
    if (value) return `${attr}=${value}`
  }
  return undefined
}

/** Linha de um par casado: compara valor e atributos, depois desce. */
function pairRow(ctx: Ctx, leftId: number, rightId: number, depth: number): DiffRow {
  const a = ctx.left.nodes[leftId]
  const b = ctx.right.nodes[rightId]
  const attrChanges = diffAttrs(a.attrs, b.attrs)
  const valueChanged = (a.value ?? '') !== (b.value ?? '')
  const status: DiffStatus =
    valueChanged || attrChanges.length > 0 ? 'changed' : 'equal'

  const childRows = diffLists(ctx, a.children, b.children, depth + 1)
  const hasChangedDescendants = childRows.some(
    (r) => r.status !== 'equal' || r.hasChangedDescendants,
  )

  ctx.summary[status]++

  return {
    id: ctx.nextId++,
    depth,
    status,
    left: leftId,
    right: rightId,
    name: b.name,
    path: b.path,
    leftValue: a.value,
    rightValue: b.value,
    attrChanges,
    hasChangedDescendants,
    childRows,
    isLast: false,
  }
}

/** Linha de uma subárvore que só existe de um lado. */
function sideRow(
  ctx: Ctx,
  doc: XmlDocument,
  id: number,
  status: 'added' | 'removed',
  depth: number,
): DiffRow {
  const node = doc.nodes[id]
  ctx.summary[status]++

  const childRows = node.children.map((child) =>
    sideRow(ctx, doc, child, status, depth + 1),
  )
  markLast(childRows)

  return {
    id: ctx.nextId++,
    depth,
    status,
    left: status === 'removed' ? id : undefined,
    right: status === 'added' ? id : undefined,
    name: node.name,
    path: node.path,
    leftValue: status === 'removed' ? node.value : undefined,
    rightValue: status === 'added' ? node.value : undefined,
    attrChanges: Object.entries(node.attrs).map(([name, value]) => ({
      name,
      left: status === 'removed' ? value : undefined,
      right: status === 'added' ? value : undefined,
      status,
    })),
    hasChangedDescendants: false,
    childRows,
    isLast: false,
  }
}

function diffAttrs(
  a: Record<string, string>,
  b: Record<string, string>,
): AttrChange[] {
  const out: AttrChange[] = []
  for (const name in a) {
    if (!(name in b)) out.push({ name, left: a[name], status: 'removed' })
    else if (a[name] !== b[name])
      out.push({ name, left: a[name], right: b[name], status: 'changed' })
  }
  for (const name in b) {
    if (!(name in a)) out.push({ name, right: b[name], status: 'added' })
  }
  return out
}

function markLast(rows: DiffRow[]): void {
  if (rows.length) rows[rows.length - 1].isLast = true
}

/* ------------------------------------------------------------------ */
/* Achatamento para a lista virtualizada                               */
/* ------------------------------------------------------------------ */

export interface FlatDiffRow extends DiffRow {
  /** Guias de profundidade: `true` quando o ancestral daquele nível é o último. */
  guides: boolean[]
  hasChildren: boolean
  expanded: boolean
}

export interface FlattenDiffOptions {
  expanded: Set<number>
  /** Esconde subárvores idênticas — o modo padrão em revisão de arquivo. */
  onlyDifferences: boolean
}

export function flattenDiff(
  rows: DiffRow[],
  options: FlattenDiffOptions,
): FlatDiffRow[] {
  const out: FlatDiffRow[] = []

  const walk = (list: DiffRow[], guides: boolean[]) => {
    for (const row of list) {
      const interesting = row.status !== 'equal' || row.hasChangedDescendants
      if (options.onlyDifferences && !interesting) continue

      const hasChildren = row.childRows.length > 0
      const expanded = options.expanded.has(row.id)
      out.push({ ...row, guides, hasChildren, expanded })
      if (hasChildren && expanded) walk(row.childRows, [...guides, row.isLast])
    }
  }

  walk(rows, [])
  return out
}

/** Ids que devem começar abertos: todo ancestral de alguma diferença. */
export function autoExpand(rows: DiffRow[], limit = 4000): Set<number> {
  const out = new Set<number>()
  const walk = (list: DiffRow[]) => {
    for (const row of list) {
      if (out.size >= limit) return
      if (row.hasChangedDescendants) {
        out.add(row.id)
        walk(row.childRows)
      }
    }
  }
  walk(rows)
  return out
}
