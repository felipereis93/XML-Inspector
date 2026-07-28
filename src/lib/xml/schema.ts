import type { FieldKind, XmlDocument } from '../../types/xml'

/**
 * Detecção de esquema embutido no documento.
 *
 * Alguns formatos declaram as próprias colunas dentro do XML. O caso mais
 * comum no Brasil é o DATAPACKET do ClientDataSet (Delphi), exportado por
 * praticamente todo ERP legado:
 *
 *   <DATAPACKET Version="2.0">
 *     <METADATA><FIELDS>
 *       <FIELD attrname="LCDTCE_ValorDebito" fieldtype="string" WIDTH="17"/>
 *     </FIELDS></METADATA>
 *     <ROWDATA><ROW LCDTCE_ValorDebito="100.00"/></ROWDATA>
 *   </DATAPACKET>
 *
 * Sem entender isso, um índice de campos ingênuo lista `attrname`,
 * `fieldtype`, `WIDTH` e `Version` — que são o vocabulário do formato, não
 * colunas de dados — e esconde os nomes que interessam no meio deles.
 */

export type Dialect = 'datapacket' | 'generic'

export interface DeclaredField {
  name: string
  /** Posição na declaração, para preservar a ordem das colunas do arquivo. */
  order: number
  /** Valor cru de `fieldtype` (`i4`, `r8`, `string`, `dateTime`, …). */
  declaredType?: string
  width?: number
  decimals?: number
  /** Tipo declarado traduzido para os três tipos que a interface oferece. */
  kind: FieldKind
}

export interface DocumentSchema {
  dialect: Dialect
  /** Colunas declaradas, por nome, na ordem em que o arquivo as declara. */
  declared: Map<string, DeclaredField>
  /** Raiz da subárvore de metadados (`/DATAPACKET/METADATA`). */
  metadataRoot?: string
  /** Raiz da subárvore de dados (`/DATAPACKET/ROWDATA`). */
  dataRoot?: string
}

export const GENERIC_SCHEMA: DocumentSchema = {
  dialect: 'generic',
  declared: new Map(),
}

/** Tipos MIDAS/ClientDataSet que representam número. */
const NUMERIC_TYPES = new Set([
  'i1', 'i2', 'i4', 'i8',
  'ui1', 'ui2', 'ui4', 'ui8',
  'r4', 'r8',
  'fixed', 'fixedFMT',
  'bcd', 'bcdFMT',
  'float', 'integer', 'currency',
])

/** Tipos MIDAS/ClientDataSet que representam data ou hora. */
const DATE_TYPES = new Set(['date', 'time', 'dateTime', 'timeStamp'])

export function detectSchema(doc: XmlDocument | undefined): DocumentSchema {
  if (!doc) return GENERIC_SCHEMA

  const declared = new Map<string, DeclaredField>()
  let metadataRoot: string | undefined
  let dataRoot: string | undefined
  let order = 0

  for (const node of doc.nodes) {
    if (node.name === 'ROWDATA' && dataRoot === undefined) {
      dataRoot = node.path
      continue
    }
    if (node.name !== 'FIELD') continue

    const name = node.attrs.attrname
    if (!name || declared.has(name)) continue

    const declaredType = node.attrs.fieldtype
    declared.set(name, {
      name,
      order: order++,
      declaredType,
      width: toInt(node.attrs.WIDTH ?? node.attrs.width),
      decimals: toInt(node.attrs.DECIMALS ?? node.attrs.decimals),
      kind: kindOfDeclaredType(declaredType),
    })

    if (metadataRoot === undefined) {
      metadataRoot = metadataRootOf(doc, node.id)
    }
  }

  if (declared.size === 0) return GENERIC_SCHEMA
  return { dialect: 'datapacket', declared, metadataRoot, dataRoot }
}

/**
 * O `<FIELD>` pode estar aninhado em datasets encadeados, então subimos até o
 * `METADATA` mais externo em vez de assumir dois níveis acima.
 */
function metadataRootOf(doc: XmlDocument, fieldId: number): string | undefined {
  let found: string | undefined
  let cur = doc.nodes[fieldId].parent
  while (cur >= 0) {
    const node = doc.nodes[cur]
    if (node.name === 'METADATA') found = node.path
    cur = node.parent
  }
  if (found) return found
  // Sem `METADATA`: o pai de `FIELDS` já delimita o bloco de declaração.
  const fields = doc.nodes[fieldId].parent
  return fields >= 0 ? doc.nodes[fields].path : undefined
}

export function kindOfDeclaredType(declaredType?: string): FieldKind {
  if (!declaredType) return 'text'
  if (NUMERIC_TYPES.has(declaredType)) return 'number'
  if (DATE_TYPES.has(declaredType)) return 'date'
  return 'text'
}

/**
 * Limite de caracteres declarado para um atributo, quando o arquivo declara.
 *
 * O `WIDTH` do DATAPACKET é a largura da coluna no sistema de origem. Respeitá-lo
 * na edição evita produzir um arquivo que o destino recusa na importação — o
 * erro apareceria só lá, horas depois, sem dizer qual campo estourou.
 *
 * Campos declarados sem `WIDTH` (tipicamente `i4`, `dateTime`) não têm limite:
 * devolvemos `undefined` em vez de um palpite.
 */
export function declaredWidth(
  schema: DocumentSchema,
  attr: string | undefined,
): number | undefined {
  if (!attr) return undefined
  const width = schema.declared.get(attr)?.width
  return width !== undefined && width > 0 ? width : undefined
}

/** O caminho é a raiz ou está dentro dela. */
export function isUnder(path: string, root: string | undefined): boolean {
  if (!root) return false
  return path === root || path.startsWith(root + '/')
}

function toInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
