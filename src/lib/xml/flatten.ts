import type { XmlDocument } from '../../types/xml'

/** Uma linha visível da árvore, já pronta para a lista virtualizada. */
export interface TreeRow {
  id: number
  depth: number
  /** Uma entrada por nível ancestral: `true` se aquele ancestral era o último. */
  guides: boolean[]
  hasChildren: boolean
  expanded: boolean
  isLast: boolean
  /** O nó casou com a busca atual. */
  matched: boolean
}

export interface FlattenOptions {
  expanded: Set<number>
  /** Restringe a árvore aos nós desse conjunto. `null` mostra tudo. */
  visible?: Set<number> | null
  matched?: Set<number>
}

/**
 * Converte a árvore no array de linhas visíveis. Roda a cada mudança de
 * expansão, filtro ou busca — por isso é iterativo e faz uma única passagem,
 * sem alocar por nó além da própria linha.
 */
export function flattenTree(
  doc: XmlDocument | undefined,
  options: FlattenOptions,
): TreeRow[] {
  if (!doc || doc.nodes.length === 0) return []
  const { expanded, visible = null, matched } = options

  const out: TreeRow[] = []
  const stack: Array<{ id: number; guides: boolean[]; isLast: boolean }> = []

  const rootVisible = !visible || visible.has(doc.root)
  if (rootVisible) stack.push({ id: doc.root, guides: [], isLast: true })

  while (stack.length) {
    const { id, guides, isLast } = stack.pop()!
    const node = doc.nodes[id]

    const children = visible
      ? node.children.filter((c) => visible.has(c))
      : node.children
    const isExpanded = expanded.has(id)

    out.push({
      id,
      depth: guides.length,
      guides,
      hasChildren: children.length > 0,
      expanded: isExpanded,
      isLast,
      matched: matched?.has(id) ?? false,
    })

    if (children.length && isExpanded) {
      const childGuides = [...guides, isLast]
      // Empilha ao contrário para desempilhar na ordem do documento.
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({
          id: children[i],
          guides: childGuides,
          isLast: i === children.length - 1,
        })
      }
    }
  }

  return out
}

/** Ids abertos por padrão: a raiz e tudo até a profundidade pedida. */
export function expandToDepth(
  doc: XmlDocument | undefined,
  depth: number,
): Set<number> {
  const out = new Set<number>()
  if (!doc) return out
  for (const node of doc.nodes) {
    if (node.depth < depth && node.children.length) out.add(node.id)
  }
  return out
}

export function expandAll(doc: XmlDocument | undefined): Set<number> {
  const out = new Set<number>()
  if (!doc) return out
  for (const node of doc.nodes) if (node.children.length) out.add(node.id)
  return out
}

// A serialização vive em `serialize.ts`, que é o mesmo código usado pela
// exportação — copiar um nó e baixar o arquivo produzem a mesma saída.
export { serializeSubtree } from './serialize'
