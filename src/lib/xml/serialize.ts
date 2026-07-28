import type { XmlDocument } from '../../types/xml'

/**
 * Documento em memória -> string XML válida e indentada.
 *
 * A saída é equivalente ao original em conteúdo, não byte a byte. O parser
 * normaliza espaço em branco e descarta comentários, então reexportar
 * reformata o arquivo. Para dados isso é o comportamento desejado; para XML
 * de documento (com conteúdo misto) veja `countMixedContent`.
 */

export interface SerializeOptions {
  /** Recuo por nível. */
  indent?: string
  /** Emite a declaração `<?xml …?>` quando o documento tinha uma. */
  declaration?: boolean
  /** Elemento vazio vira `<tag/>` em vez de `<tag></tag>`. */
  selfClosing?: boolean
}

const DEFAULTS: Required<SerializeOptions> = {
  indent: '  ',
  declaration: true,
  selfClosing: true,
}

export function serializeDocument(
  doc: XmlDocument,
  options: SerializeOptions = {},
): string {
  const opts = { ...DEFAULTS, ...options }
  const out: string[] = []

  if (opts.declaration && doc.declaration) {
    out.push(`<?xml${attributesOf(doc.declaration)}?>`)
  }

  write(out, doc, doc.root, 0, opts)
  return out.join('\n') + '\n'
}

/** Uma subárvore isolada, para copiar um nó da interface. */
export function serializeSubtree(
  doc: XmlDocument,
  nodeId: number,
  options: SerializeOptions = {},
): string {
  const opts = { ...DEFAULTS, ...options, declaration: false }
  const out: string[] = []
  write(out, doc, nodeId, 0, opts)
  return out.join('\n')
}

function write(
  out: string[],
  doc: XmlDocument,
  id: number,
  depth: number,
  opts: Required<SerializeOptions>,
): void {
  const node = doc.nodes[id]
  if (!node) return

  const pad = opts.indent.repeat(depth)
  const attrs = attributesOf(node.attrs)
  const hasText = node.value !== undefined && node.value !== ''

  if (node.children.length === 0) {
    if (!hasText) {
      out.push(
        opts.selfClosing
          ? `${pad}<${node.name}${attrs}/>`
          : `${pad}<${node.name}${attrs}></${node.name}>`,
      )
      return
    }
    out.push(
      `${pad}<${node.name}${attrs}>${escapeText(node.value!)}</${node.name}>`,
    )
    return
  }

  out.push(`${pad}<${node.name}${attrs}>`)
  // Conteúdo misto: o texto do nó é escrito antes dos filhos. A posição
  // original entre os filhos não é preservada — ver `countMixedContent`.
  if (hasText) out.push(`${pad}${opts.indent}${escapeText(node.value!)}`)
  for (const child of node.children) write(out, doc, child, depth + 1, opts)
  out.push(`${pad}</${node.name}>`)
}

function attributesOf(attrs: Record<string, string>): string {
  let out = ''
  for (const name in attrs) out += ` ${name}="${escapeAttribute(attrs[name])}"`
  return out
}

/** `&` e `<` são obrigatórios; `>` é escapado por segurança contra `]]>`. */
function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;',
  )
}

/**
 * Em atributo, aspas e quebras de linha também precisam virar entidade: um
 * `\n` cru seria normalizado para espaço na próxima leitura, alterando o dado.
 */
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"\r\n\t]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case '\r':
        return '&#13;'
      case '\n':
        return '&#10;'
      default:
        return '&#9;'
    }
  })
}

/**
 * Nós que têm texto e filhos ao mesmo tempo. Só nesses casos a reexportação
 * pode reordenar o conteúdo, então a interface avisa apenas quando ocorre.
 */
export function countMixedContent(doc: XmlDocument | undefined): number {
  if (!doc) return 0
  let total = 0
  for (const node of doc.nodes) {
    if (node.children.length > 0 && node.value !== undefined && node.value !== '') {
      total++
    }
  }
  return total
}

// O disparo do download vive em `lib/download.ts`. Este módulo é só string
// entrando e string saindo, então roda igual no navegador e nos testes de
// linha de comando — que é como o round-trip é verificado.
