/**
 * Verificação rápida do núcleo, fora do navegador: `npm run smoke`.
 * Roda parser, esquema, índice de campos, filtros, totais, tabela e diff
 * contra os XMLs de exemplo e imprime o resultado para conferência a olho.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseXml } from '../src/lib/xml/parse'
import { formatDecimal, formatNumber, toNumber } from '../src/lib/xml/coerce'
import { declaredWidth, detectSchema } from '../src/lib/xml/schema'
import { buildFieldIndex, findField, numericFields } from '../src/lib/xml/fields'
import {
  computeFieldGrouped,
  computeFieldStats,
  tableProfiles,
} from '../src/lib/xml/stats'
import { GENERIC_SCHEMA } from '../src/lib/xml/schema'
import { diffDocuments } from '../src/lib/xml/diff'
import { buildTable } from '../src/lib/xml/table'
import { applyFilters, splitValues } from '../src/lib/xml/filters'
import { searchDocument } from '../src/lib/xml/search'
import {
  applyEdits,
  clearEdit,
  clearNodeEdits,
  countEdits,
  writeEdit,
} from '../src/lib/xml/edits'
import { serializeDocument } from '../src/lib/xml/serialize'
import type {
  DiffRow,
  DocumentEdits,
  Filter,
  XmlDocument,
  XmlField,
} from '../src/types/xml'

const samples = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples')
const read = (name: string) =>
  parseXml(name, readFileSync(join(samples, name), 'utf8'))

const section = (title: string) => console.log(`\n— ${title} —`)

/* ================================================================== */
/* NF-e: dados em texto de elemento                                    */
/* ================================================================== */

const a = read('nfe-v1.xml')
const b = read('nfe-v2.xml')
const nfeFields = buildFieldIndex(a)
const vProd = findField(nfeFields, 'vProd', 'element')!
const xProd = findField(nfeFields, 'xProd', 'element')!

console.log(`nós: v1=${a.nodes.length} v2=${b.nodes.length}`)

section('totais de vProd (esperado: 4 itens, soma 1168.90)')
console.log(' ', computeFieldStats(a, vProd))

section('vProd por xProd')
for (const row of computeFieldGrouped(a, vProd, xProd)) {
  console.log(`  ${row.key.padEnd(24)} ${row.sum}  (${(row.share * 100).toFixed(1)}%)`)
}

section('candidatos a tabela')
console.log(
  '  ',
  tableProfiles(a, GENERIC_SCHEMA).map((p) => `${p.leaf} x${p.count}`).join(', '),
)

const table = buildTable(a, '/nfeProc/NFe/infNFe/det')
section(`tabela de det: ${table.rows.length} linhas, ${table.columns.length} colunas`)
console.log('  ', table.columns.map((c) => c.key + (c.numeric ? '*' : '')).join(' | '))

section('filtro: vProd entre 250 e 500')
const visible = applyFilters(a, [
  {
    id: '1',
    group: 'g1',
    field: 'vProd',
    source: 'element',
    op: 'between',
    values: [],
    min: 250,
    max: 500,
    kind: 'number',
    enabled: true,
  },
])
console.log(`  ${visible?.size} nós visíveis de ${a.nodes.length}`)
console.log(
  '  itens mantidos:',
  [...(visible ?? [])]
    .map((id) => a.nodes[id])
    .filter((n) => n.name === 'vProd')
    .map((n) => n.value)
    .join(', '),
)

const found = searchDocument(a, 'Aurora')
section(`busca "Aurora": ${found.hits.length} ocorrência(s), ${found.reveal.size} a revelar`)

section('diff v1 -> v2')
const diff = diffDocuments(a, b)
console.log('  ', diff.summary)

/* ================================================================== */
/* DATAPACKET: esquema declarado, dados em atributo                    */
/* ================================================================== */

const dp = read('datapacket.xml')
const schema = detectSchema(dp)
const fields = buildFieldIndex(dp, schema)

section('esquema detectado')
console.log(`  dialeto: ${schema.dialect}`)
console.log(`  metadados: ${schema.metadataRoot}`)
console.log(`  dados: ${schema.dataRoot}`)
console.log(`  colunas declaradas: ${schema.declared.size}`)

section(`índice de campos (${fields.length})`)
for (const f of fields) {
  const tipo = f.isNumeric ? 'número' : f.isDate ? 'data' : 'texto'
  const declarado = f.declaredType ? `declarado ${f.declaredType}` : 'não declarado'
  console.log(
    `  ${f.name.padEnd(23)} ${tipo.padEnd(7)} x${String(f.count).padEnd(3)} ${declarado}`,
  )
}

section('metadados NÃO devem virar campo')
const leaked = ['attrname', 'fieldtype', 'WIDTH', 'Version', 'DEFAULT_ORDER', 'PRIMARY_KEY']
  .filter((name) => fields.some((f) => f.name === name))
console.log(leaked.length === 0 ? '  OK — nenhum vazou' : `  FALHOU: ${leaked.join(', ')}`)

section('campos totalizáveis')
console.log('  ', numericFields(fields).map((f) => f.name).join(', '))

const debito = findField(fields, 'LCDTCE_ValorDebito', 'attribute')!
const conta = findField(fields, 'ECTCE_Codigo', 'attribute')!

section('totais de LCDTCE_ValorDebito (declarado string, valores numéricos)')
console.log(' ', computeFieldStats(dp, debito))

section('LCDTCE_ValorDebito por ECTCE_Codigo')
for (const row of computeFieldGrouped(dp, debito, conta)) {
  console.log(
    `  ${row.key.padEnd(14)} ${String(row.sum).padStart(10)}  (${(row.share * 100).toFixed(1)}%)  n=${row.count}`,
  )
}

const run = (doc: XmlDocument, label: string, patch: Partial<Filter>) => {
  const filter: Filter = {
    id: label,
    group: 'g1',
    field: '',
    source: 'attribute',
    op: 'equals',
    values: [],
    kind: 'text',
    enabled: true,
    ...patch,
  }
  const scope = applyFilters(doc, [filter])
  const rows = [...(scope ?? [])]
    .map((id) => doc.nodes[id])
    .filter((n) => n.name === 'ROW')
  console.log(
    `  ${label.padEnd(36)} ${String(rows.length).padStart(2)} ROW  ->  ${rows
      .map((r) => r.attrs.LCDTCE_NumLancamento)
      .join(', ')}`,
  )
}

section('filtros por nome de campo (sem informar a tag ROW)')
run(dp, 'ValorDebito > 10000', {
  field: 'LCDTCE_ValorDebito',
  source: 'attribute',
  op: 'gt',
  min: 10000,
  kind: 'number',
})
run(dp, 'ValorCredito >= 2415.80', {
  field: 'LCDTCE_ValorCredito',
  source: 'attribute',
  op: 'gte',
  min: 2415.8,
  kind: 'number',
})
run(dp, 'ValorDebito entre 8000 e 60000', {
  field: 'LCDTCE_ValorDebito',
  source: 'attribute',
  op: 'between',
  min: 8000,
  max: 60000,
  kind: 'number',
})
run(dp, 'Historico contém "mercadorias"', {
  field: 'LCDTCE_Historico',
  source: 'attribute',
  op: 'contains',
  values: ['mercadorias'],
  kind: 'text',
})
run(dp, 'DataLancamento a partir de 15/03', {
  field: 'LCDTCE_DataLancamento',
  source: 'attribute',
  op: 'gte',
  min: Date.parse('2024-03-15'),
  kind: 'date',
})
run(dp, 'ECTCE_Codigo começa com 312', {
  field: 'ECTCE_Codigo',
  source: 'attribute',
  op: 'starts',
  values: ['312'],
  kind: 'number',
})
run(dp, 'Observacao está preenchido', {
  field: 'LCDTCE_Observacao',
  source: 'attribute',
  op: 'exists',
  kind: 'text',
})

/* ================================================================== */
/* Edição, serialização e round-trip                                   */
/* ================================================================== */

section('edição em overlay')
let overlay: DocumentEdits = {}
const rowNode = dp.nodes.find(
  (n) => n.name === 'ROW' && n.attrs.LCDTCE_NumLancamento === '1001',
)!

overlay = writeEdit(overlay, dp, { node: rowNode.id, attr: 'LCDTCE_ValorDebito' }, '99999.99')
overlay = writeEdit(overlay, dp, { node: rowNode.id, attr: 'ECTCE_Codigo' }, '00000000001')
console.log(`  2 edições -> countEdits = ${countEdits(overlay)}`)
console.log(`  documento original intocado: ${rowNode.attrs.LCDTCE_ValorDebito}`)

const edited = applyEdits(dp, overlay)!
console.log(`  documento efetivo: ${edited.nodes[rowNode.id].attrs.LCDTCE_ValorDebito}`)
console.log(
  `  total recalculado: ${computeFieldStats(edited, debito).sum}` +
    `  (antes ${computeFieldStats(dp, debito).sum})`,
)

section('digitar de volta o valor original não conta como alteração')
const restored = writeEdit(
  overlay,
  dp,
  { node: rowNode.id, attr: 'LCDTCE_ValorDebito' },
  rowNode.attrs.LCDTCE_ValorDebito,
)
console.log(`  countEdits = ${countEdits(restored)} (esperado 1)`)

section('desfazer')
console.log(
  `  campo:  ${countEdits(clearEdit(overlay, { node: rowNode.id, attr: 'ECTCE_Codigo' }))}` +
    `   nó: ${countEdits(clearNodeEdits(overlay, rowNode.id))}`,
)

section('round-trip: serializar -> reparsear -> comparar')
const xml = serializeDocument(edited)
const reparsed = parseXml('reexportado.xml', xml)
const roundTrip = diffDocuments(edited, reparsed)
console.log(`  nós: ${edited.nodes.length} -> ${reparsed.nodes.length}`)
console.log('  ', roundTrip.summary)
console.log(
  roundTrip.identical
    ? '  OK — o arquivo reexportado relê idêntico ao que está na tela'
    : '  FALHOU — a reexportação perdeu ou alterou informação',
)

section('escape de caracteres especiais')
const tricky = parseXml(
  'tricky.xml',
  '<r><a v="&lt;b&gt; &amp; &quot;c&quot;">x &amp; y</a></r>',
)
const trickyXml = serializeDocument(tricky)
const trickyBack = parseXml('t2.xml', trickyXml)
console.log('  saída:', trickyXml.trim().replace(/\n\s*/g, ' '))
console.log(
  `  atributo preservado: ${trickyBack.nodes[1].attrs.v === tricky.nodes[1].attrs.v}` +
    `   texto preservado: ${trickyBack.nodes[1].value === tricky.nodes[1].value}`,
)

/* ================================================================== */
/* Coerção: código com zero à esquerda vs. decimal preenchido          */
/* ================================================================== */

section('texto -> número')
for (const [raw, expected] of [
  // Decimais preenchidos com zeros — folha de pagamento, ERP.
  ['00000000003675.13', 3675.13],
  ['00000000000000.00', 0],
  ['00000000006603.97', 6603.97],
  // Identificadores: zero à esquerda e nenhum separador decimal.
  ['09012100', undefined], // NCM
  ['00', undefined], // CST
  ['01402000', undefined], // CEP
  ['0000000629', undefined], // matrícula
  // Números comuns.
  ['0', 0],
  ['0.50', 0.5],
  ['-0.5', -0.5],
  ['1234.56', 1234.56],
  ['1.234,56', 1234.56],
  // Não é número.
  ['01500/2012', undefined],
  ['R$ 1.234,56 (à vista)', undefined],
] as Array<[string, number | undefined]>) {
  const got = toNumber(raw)
  const ok = Object.is(got, expected)
  console.log(
    `  ${ok ? 'OK    ' : 'FALHOU'} ${raw.padEnd(24)} -> ${String(got).padEnd(10)} (esperado ${expected})`,
  )
}

section('formatação: nada de notação compacta')
for (const n of [
  25148932.45, 2606993.62, 1234567890.12, 999999999999.99, 853, 0, -4500.5,
]) {
  console.log(
    `  ${String(n).padEnd(16)} formatNumber=${formatNumber(n).padEnd(20)}` +
      ` formatDecimal=${formatDecimal(n)}`,
  )
}
{
  const compacto = ['mi', 'mil', 'bi', 'K', 'M', 'B'].filter((s) =>
    [25148932.45, 1234567890.12, 999999999999.99].some((n) =>
      formatDecimal(n).includes(s),
    ),
  )
  console.log(
    compacto.length === 0
      ? '  OK — nenhum sufixo de abreviação na saída'
      : `  FALHOU: ${compacto.join(', ')}`,
  )
}

/* ================================================================== */
/* Filtro multivalor (IN) e grupos OU/E                                */
/* ================================================================== */

{
  const mv = read('contas-multivalor.xml')
  const lanc = (scope: Set<number> | null) =>
    [...(scope ?? [])]
      .map((id) => mv.nodes[id])
      .filter((n) => n.name === 'ROW')
      .map((n) => n.attrs.LCDTCE_NumLancamento)
      .join(', ') || '(nenhum)'

  const f = (patch: Partial<Filter>): Filter => ({
    id: crypto.randomUUID(),
    group: 'g1',
    field: '',
    source: 'attribute',
    op: 'equals',
    values: [],
    kind: 'text',
    enabled: true,
    ...patch,
  })

  section('multivalor: ECTCE_Codigo IN (53110000000, 53120000000)')
  console.log(
    '  lançamentos:',
    lanc(
      applyFilters(mv, [
        f({ field: 'ECTCE_Codigo', values: ['53110000000', '53120000000'] }),
      ]),
    ),
  )

  section('um valor só continua funcionando (caso trivial da lista)')
  console.log(
    '  lançamentos:',
    lanc(applyFilters(mv, [f({ field: 'ECTCE_Codigo', values: ['53110000000'] })])),
  )

  section('OU no mesmo grupo: dois filtros, campos diferentes')
  console.log(
    '  lançamentos:',
    lanc(
      applyFilters(mv, [
        f({ group: 'g1', field: 'ECTCE_Codigo', values: ['61110000000'] }),
        f({
          group: 'g1',
          field: 'LCDTCE_Historico',
          op: 'contains',
          values: ['IPVA'],
        }),
      ]),
    ),
  )

  section('E entre grupos: (código IN 5311,5312) E (histórico contém complementar)')
  console.log(
    '  lançamentos:',
    lanc(
      applyFilters(mv, [
        f({
          group: 'g1',
          field: 'ECTCE_Codigo',
          values: ['53110000000', '53120000000'],
        }),
        f({
          group: 'g2',
          field: 'LCDTCE_Historico',
          op: 'contains',
          values: ['complementar'],
        }),
      ]),
    ),
  )

  section('contains multivalor: histórico contém FUNDEB OU IPVA')
  console.log(
    '  lançamentos:',
    lanc(
      applyFilters(mv, [
        f({ field: 'LCDTCE_Historico', op: 'contains', values: ['FUNDEB', 'IPVA'] }),
      ]),
    ),
  )

  section('lista vazia não restringe nada')
  console.log(
    `  applyFilters devolve null: ${
      applyFilters(mv, [f({ field: 'ECTCE_Codigo', values: [] })]) === null
    }`,
  )

  section('colagem de planilha vira valores')
  console.log(
    '  ',
    JSON.stringify(splitValues('53110000000,53120000000;\n61110000000\t\n')),
  )
}

section('WIDTH declarado -> maxLength do campo')
{
  // Arquivo real de carga inicial (DOCUMENTO_DIVERSO), com uma linha só.
  const dd = read('documento-diverso.xml')
  const s = detectSchema(dd)
  const row = dd.nodes.find((n) => n.name === 'ROW')!

  console.log(`  candidatos a tabela: ${tableProfiles(dd, s).length} (esperado 1)`)
  for (const [attr, value] of Object.entries(row.attrs)) {
    const w = declaredWidth(s, attr)
    const state =
      w === undefined
        ? 'sem limite'
        : value.length > w
          ? 'ESTOURA'
          : value.length === w
            ? 'no limite'
            : 'ok'
    console.log(
      `  ${attr.padEnd(18)} "${value}"`.padEnd(60) +
        `${String(value.length).padStart(2)}/${w ?? '—'}  ${state}`,
    )
  }
  for (const attr of ['DD_TipoPeriodo', 'DD_Inexistente']) {
    console.log(`  ${attr.padEnd(18)} (ausente na linha)`.padEnd(60) +
      `maxLength=${declaredWidth(s, attr) ?? '—'}`)
  }
}

section('campos que já chegam acima da largura declarada')
{
  // Esquema de bolso com uma largura curta, para exercitar a detecção sem
  // depender de um arquivo sujo em samples/.
  const doc = parseXml(
    'largura.xml',
    '<DATAPACKET><METADATA><FIELDS>' +
      '<FIELD attrname="Nome" fieldtype="string" WIDTH="10"/>' +
      '<FIELD attrname="Codigo" fieldtype="i4"/>' +
      '</FIELDS></METADATA><ROWDATA>' +
      '<ROW Nome="curto" Codigo="1"/>' +
      '<ROW Nome="nome muito comprido" Codigo="2"/>' +
      '</ROWDATA></DATAPACKET>',
  )
  const s = detectSchema(doc)
  for (const node of doc.nodes) {
    if (node.name !== 'ROW') continue
    for (const [attr, value] of Object.entries(node.attrs)) {
      const w = declaredWidth(s, attr)
      if (w === undefined) continue
      const over = value.length > w
      console.log(
        `  ${attr}="${value}" ${String(value.length).padStart(2)}/${w} ` +
          (over ? '<- ESTOURA' : 'ok'),
      )
    }
  }
}

section('nome do arquivo exportado = nome importado, sem transformação')
for (const name of [
  'LANÇAMENTO_CONTABIL_2025.xml',
  'razao 2024-03.XML',
  'export.nfe',
]) {
  const opened = parseXml(name, '<r/>')
  const edited2 = applyEdits(opened, {})!
  const ok = edited2.fileName === name
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} "${name}" -> "${edited2.fileName}"`)
}

section('primeiras linhas do XML exportado')
console.log(
  xml
    .split('\n')
    .slice(0, 12)
    .map((l) => '  ' + l)
    .join('\n'),
)

/* Detalhe do diff, no fim para não poluir o resumo. */
section('diff v1 -> v2, detalhado')
const lines: string[] = []
const walk = (rows: DiffRow[]) => {
  for (const row of rows) {
    if (row.status !== 'equal') {
      const detail =
        row.status === 'changed'
          ? `  "${row.leftValue ?? ''}" -> "${row.rightValue ?? ''}"`
          : ''
      lines.push(`  ${row.status.padEnd(8)} ${row.path}${detail}`)
    }
    walk(row.childRows)
  }
}
walk(diff.rows)
console.log(lines.filter((l) => !l.includes('/det/')).join('\n'))

export type { XmlField }
