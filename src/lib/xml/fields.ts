import type {
  FieldKind,
  FieldSource,
  XmlDocument,
  XmlField,
} from '../../types/xml'
import { detectSchema, isUnder, type DocumentSchema } from './schema'

/**
 * Índice de campos do documento: um item por nome de atributo e por nome de
 * tag que carrega valor, independente de onde ocorrem.
 *
 * Quando o documento declara o próprio esquema (DATAPACKET), o índice passa a
 * ser a lista de colunas declaradas, e não todo atributo encontrado na árvore.
 * Sem isso o `<FIELD attrname="X" fieldtype="i4"/>` contribui com os campos
 * `attrname` e `fieldtype` — o vocabulário do formato — enquanto `X`, que é a
 * coluna de verdade, se perde no meio.
 *
 * A construção é uma dobra sobre `doc.profiles`, não sobre `doc.nodes`. Um
 * documento com 200 mil nós costuma ter algumas dezenas de caminhos, então
 * isso custa quase nada e pode ser memoizado na thread principal.
 */
export function buildFieldIndex(
  doc: XmlDocument | undefined,
  schema: DocumentSchema = detectSchema(doc),
): XmlField[] {
  if (!doc) return []

  const byId = new Map<string, XmlField>()
  const scoped = schema.dialect !== 'generic'

  const blank = (id: string, name: string, source: FieldSource): XmlField => ({
    id,
    name,
    source,
    count: 0,
    valued: 0,
    numericCount: 0,
    dateCount: 0,
    isNumeric: false,
    isDate: false,
    samples: [],
    paths: [],
    declared: false,
    order: Number.POSITIVE_INFINITY,
  })

  const upsert = (
    name: string,
    source: FieldSource,
    path: string,
    stats: {
      count: number
      valued: number
      numericCount: number
      dateCount: number
      min?: number
      max?: number
      samples: string[]
    },
  ) => {
    const id = fieldId(name, source)
    let field = byId.get(id)
    if (!field) byId.set(id, (field = blank(id, name, source)))

    field.count += stats.count
    field.valued += stats.valued
    field.numericCount += stats.numericCount
    field.dateCount += stats.dateCount
    if (stats.min !== undefined) {
      field.min = field.min === undefined ? stats.min : Math.min(field.min, stats.min)
    }
    if (stats.max !== undefined) {
      field.max = field.max === undefined ? stats.max : Math.max(field.max, stats.max)
    }
    for (const sample of stats.samples) {
      if (field.samples.length < 5 && !field.samples.includes(sample)) {
        field.samples.push(sample)
      }
    }
    if (!field.paths.includes(path)) field.paths.push(path)
  }

  for (const profile of Object.values(doc.profiles)) {
    // Com esquema detectado, só a subárvore de dados produz campos. É isso que
    // descarta `attrname`/`fieldtype`/`WIDTH` do bloco de metadados e o
    // `Version` da raiz do DATAPACKET.
    if (scoped) {
      if (isUnder(profile.path, schema.metadataRoot)) continue
      if (schema.dataRoot && !isUnder(profile.path, schema.dataRoot)) continue
    }

    for (const attr of Object.values(profile.attrs)) {
      upsert(attr.name, 'attribute', profile.path, attr)
    }
    // Tags sem valor em nenhuma ocorrência são contêineres: filtrar por elas
    // não responderia nenhuma pergunta, então ficam fora da lista.
    if (profile.valued > 0) {
      upsert(profile.leaf, 'element', profile.path, profile)
    }
  }

  // Coluna declarada que não apareceu em nenhuma linha ainda é uma coluna do
  // arquivo. Entra com contagem zero, em vez de sumir da lista.
  for (const declared of schema.declared.values()) {
    const id = fieldId(declared.name, 'attribute')
    if (!byId.has(id)) byId.set(id, blank(id, declared.name, 'attribute'))
  }

  const fields = [...byId.values()]
  for (const field of fields) {
    const declared = schema.declared.get(field.name)
    if (declared) {
      field.declared = true
      field.declaredType = declared.declaredType
      field.width = declared.width
      field.order = declared.order
    }

    /**
     * A observação vence o tipo declarado. Exportações DATAPACKET reais
     * declaram dinheiro como `fieldtype="string"` o tempo todo; obedecer isso
     * tiraria "maior que" justamente do campo em que ele mais importa. O tipo
     * declarado só decide quando não há nenhum valor para observar.
     */
    if (field.valued > 0) {
      field.isNumeric = field.numericCount / field.valued >= 0.9
      field.isDate = !field.isNumeric && field.dateCount / field.valued >= 0.9
    } else if (declared) {
      field.isNumeric = declared.kind === 'number'
      field.isDate = declared.kind === 'date'
    }
  }

  // Campos declarados primeiro, na ordem do arquivo — é a ordem das colunas
  // que o usuário vê no sistema de origem. O resto vem depois, alfabético.
  return fields.sort(
    (a, b) =>
      a.order - b.order ||
      a.name.localeCompare(b.name, 'pt-BR') ||
      a.source.localeCompare(b.source),
  )
}

export function fieldId(name: string, source: FieldSource): string {
  return source === 'attribute' ? `@${name}` : name
}

export function kindOf(field: XmlField | undefined): FieldKind {
  if (!field) return 'text'
  if (field.isNumeric) return 'number'
  if (field.isDate) return 'date'
  return 'text'
}

/** Busca por nome; usado para reidratar o campo escolhido em um filtro. */
export function findField(
  fields: XmlField[],
  name: string,
  source: FieldSource | 'any',
): XmlField | undefined {
  if (!name) return undefined
  if (source !== 'any') {
    return fields.find((f) => f.name === name && f.source === source)
  }
  return fields.find((f) => f.name === name)
}

export function findFieldById(
  fields: XmlField[],
  id: string | undefined,
): XmlField | undefined {
  return id ? fields.find((f) => f.id === id) : undefined
}

/** Campos que podem ser totalizados. */
export function numericFields(fields: XmlField[]): XmlField[] {
  return fields.filter((f) => f.isNumeric && f.count > 0)
}
