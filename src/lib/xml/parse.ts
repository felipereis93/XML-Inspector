import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { XmlDocument, XmlNode } from '../../types/xml'
import { toNumber, toTime } from './coerce'
import { buildProfiles } from './profiles'

/**
 * `preserveOrder` faz o fast-xml-parser devolver arrays em vez de objetos, o
 * que preserva ordem do documento e tags repetidas — essencial para itens de
 * nota fiscal, linhas de catálogo e qualquer coisa que apareça N vezes.
 * O parser não converte valores: a coerção é nossa, em `coerce.ts`, para que a
 * detecção de número e data siga uma regra única e auditável.
 */
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  cdataPropName: '#cdata',
  ignoreDeclaration: false,
  ignorePiTags: false,
})

/** Nó cru do fast-xml-parser em modo `preserveOrder`. */
type RawNode = Record<string, unknown> & { ':@'?: Record<string, string> }

const TEXT_KEYS = new Set(['#text', '#cdata'])

interface Frame {
  items: RawNode[]
  i: number
  parent: number
  path: string
  depth: number
  /** Quantas vezes cada nome já apareceu neste pai — alimenta `ordinal`. */
  seen: Map<string, number>
}

export interface ParseOptions {
  /** Remove o prefixo de namespace dos nomes de tag (`ns:item` -> `item`). */
  stripNamespaces?: boolean
}

/**
 * Converte o texto de um arquivo XML no documento plano usado por toda a app.
 * Faz uma única passagem: monta os nós e perfila os caminhos ao mesmo tempo.
 */
export function parseXml(
  fileName: string,
  source: string,
  bytes = source.length,
  options: ParseOptions = {},
): XmlDocument {
  const started = performance.now()

  const check = XMLValidator.validate(source, { allowBooleanAttributes: true })
  if (check !== true) {
    const { line, col, msg } = check.err
    throw new Error(`Linha ${line}, coluna ${col}: ${msg}`)
  }

  const tree = parser.parse(source) as RawNode[]
  const nodes: XmlNode[] = []
  let declaration: Record<string, string> | undefined
  let root = -1

  const stack: Frame[] = [
    { items: tree, i: 0, parent: -1, path: '', depth: 0, seen: new Map() },
  ]

  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (frame.i >= frame.items.length) {
      stack.pop()
      continue
    }

    const item = frame.items[frame.i++]
    const tag = tagKeyOf(item)
    if (!tag) continue

    // Instrução de processamento (`<?xml ... ?>`): guardamos os atributos e
    // seguimos, ela não é um nó da árvore.
    if (tag.startsWith('?')) {
      if (tag === '?xml') declaration = attrsOf(item)
      continue
    }
    if (TEXT_KEYS.has(tag) || tag === '#comment') continue

    const name = options.stripNamespaces ? stripNs(tag) : tag
    const kids = (item[tag] as RawNode[] | undefined) ?? []
    const path = `${frame.path}/${name}`
    const ordinal = frame.seen.get(name) ?? 0
    frame.seen.set(name, ordinal + 1)

    const attrs = attrsOf(item)
    const value = textOf(kids)
    const num = value === undefined ? undefined : toNumber(value)
    const time = num === undefined ? toTime(value) : undefined

    const node: XmlNode = {
      id: nodes.length,
      parent: frame.parent,
      kind: 'element',
      name,
      path,
      depth: frame.depth,
      ordinal,
      attrs,
      value,
      num,
      time,
      children: [],
    }
    nodes.push(node)
    if (frame.parent >= 0) nodes[frame.parent].children.push(node.id)
    else if (root < 0) root = node.id

    const elementKids = kids.filter((k) => {
      const key = tagKeyOf(k)
      return key !== undefined && !TEXT_KEYS.has(key) && key !== '#comment'
    })
    if (elementKids.length) {
      stack.push({
        items: elementKids,
        i: 0,
        parent: node.id,
        path,
        depth: frame.depth + 1,
        seen: new Map(),
      })
    }
  }

  const profiles = buildProfiles(nodes)

  return {
    id: `${fileName}:${started.toFixed(0)}:${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    bytes,
    parsedAt: Date.now(),
    parseMs: performance.now() - started,
    root: root < 0 ? 0 : root,
    nodes,
    profiles,
    declaration,
  }
}

function tagKeyOf(item: RawNode): string | undefined {
  for (const key in item) if (key !== ':@') return key
  return undefined
}

function attrsOf(item: RawNode): Record<string, string> {
  const raw = item[':@']
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const key in raw) out[key.startsWith('@_') ? key.slice(2) : key] = String(raw[key])
  return out
}

/** Junta `#text` e `#cdata` diretos em um único valor. */
function textOf(kids: RawNode[]): string | undefined {
  let out = ''
  for (const kid of kids) {
    const key = tagKeyOf(kid)
    if (key && TEXT_KEYS.has(key)) out += String(kid[key] ?? '')
  }
  const trimmed = out.trim()
  return trimmed === '' ? undefined : trimmed
}

function stripNs(tag: string): string {
  const i = tag.indexOf(':')
  return i > 0 ? tag.slice(i + 1) : tag
}

/** Caminho legível com índices: `/nfeProc/NFe/infNFe/det[2]/prod/vProd`. */
export function nodePath(doc: XmlDocument, id: number): string {
  const parts: string[] = []
  let cur = id
  while (cur >= 0) {
    const node = doc.nodes[cur]
    const siblings = node.parent >= 0 ? doc.nodes[node.parent].children : [cur]
    const sameName = siblings.filter((c) => doc.nodes[c].name === node.name)
    parts.push(sameName.length > 1 ? `${node.name}[${node.ordinal + 1}]` : node.name)
    cur = node.parent
  }
  return '/' + parts.reverse().join('/')
}

/** Ancestrais do nó, da raiz até o pai. */
export function ancestorsOf(doc: XmlDocument, id: number): number[] {
  const out: number[] = []
  let cur = doc.nodes[id]?.parent ?? -1
  while (cur >= 0) {
    out.push(cur)
    cur = doc.nodes[cur].parent
  }
  return out.reverse()
}
