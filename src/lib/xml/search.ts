import type { XmlDocument } from '../../types/xml'

export type HitField = 'name' | 'value' | 'attr'

export interface SearchHit {
  node: number
  field: HitField
  /** Nome do atributo, quando `field` é `attr`. */
  attr?: string
}

export interface SearchResult {
  hits: SearchHit[]
  /** Nós que contêm ao menos uma ocorrência. */
  matched: Set<number>
  /** `matched` mais todos os ancestrais — o que a árvore precisa abrir. */
  reveal: Set<number>
  truncated: boolean
}

export interface SearchOptions {
  caseSensitive?: boolean
  /** Onde procurar. Por padrão, tudo. */
  fields?: { name?: boolean; value?: boolean; attr?: boolean }
  limit?: number
}

const EMPTY: SearchResult = {
  hits: [],
  matched: new Set(),
  reveal: new Set(),
  truncated: false,
}

/**
 * Varredura linear do array plano de nós. Sem índice invertido de propósito:
 * um scan de 200 mil nós roda em poucos milissegundos e evita manter uma
 * segunda estrutura sincronizada com o documento.
 */
export function searchDocument(
  doc: XmlDocument | undefined,
  query: string,
  options: SearchOptions = {},
): SearchResult {
  const q = query.trim()
  if (!doc || q.length === 0) return EMPTY

  const {
    caseSensitive = false,
    fields = { name: true, value: true, attr: true },
    limit = 5000,
  } = options
  const needle = caseSensitive ? q : q.toLowerCase()
  const has = (h: string | undefined) =>
    h !== undefined && (caseSensitive ? h : h.toLowerCase()).includes(needle)

  const hits: SearchHit[] = []
  const matched = new Set<number>()
  let truncated = false

  for (const node of doc.nodes) {
    if (hits.length >= limit) {
      truncated = true
      break
    }
    if (fields.name !== false && has(node.name)) {
      hits.push({ node: node.id, field: 'name' })
      matched.add(node.id)
    }
    if (fields.value !== false && has(node.value)) {
      hits.push({ node: node.id, field: 'value' })
      matched.add(node.id)
    }
    if (fields.attr !== false) {
      for (const attr in node.attrs) {
        if (has(attr) || has(node.attrs[attr])) {
          hits.push({ node: node.id, field: 'attr', attr })
          matched.add(node.id)
        }
      }
    }
  }

  const reveal = new Set(matched)
  for (const id of matched) {
    let parent = doc.nodes[id].parent
    while (parent >= 0 && !reveal.has(parent)) {
      reveal.add(parent)
      parent = doc.nodes[parent].parent
    }
  }

  return { hits, matched, reveal, truncated }
}

export interface Segment {
  text: string
  hit: boolean
}

/**
 * Fatia um texto nos trechos que casam com a busca, para o realce.
 * Devolve um único segmento sem realce quando não há ocorrência, o que deixa
 * o componente de exibição livre de ramificações.
 */
export function segment(
  text: string,
  query: string,
  caseSensitive = false,
): Segment[] {
  const q = query.trim()
  if (!q) return [{ text, hit: false }]

  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? q : q.toLowerCase()
  const out: Segment[] = []
  let cursor = 0

  for (;;) {
    const at = haystack.indexOf(needle, cursor)
    if (at < 0) break
    if (at > cursor) out.push({ text: text.slice(cursor, at), hit: false })
    out.push({ text: text.slice(at, at + needle.length), hit: true })
    cursor = at + needle.length
  }

  if (out.length === 0) return [{ text, hit: false }]
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false })
  return out
}
