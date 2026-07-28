/**
 * Diagnóstico de um arquivo específico, fora do navegador:
 *   npx tsx scripts/diagnose.ts "D:\caminho\ARQUIVO.XML"
 *
 * Mostra o que cada camada enxerga — parser, esquema, campos, tabela — para
 * localizar em qual delas um arquivo real deixa de funcionar.
 */
import { readFileSync, statSync } from 'node:fs'
import { parseXml } from '../src/lib/xml/parse'
import { detectSchema } from '../src/lib/xml/schema'
import { buildFieldIndex, numericFields } from '../src/lib/xml/fields'
import { computeFieldStats, tableProfiles } from '../src/lib/xml/stats'
import { buildTable } from '../src/lib/xml/table'
import { formatNumber } from '../src/lib/xml/coerce'

const path = process.argv[2]
if (!path) {
  console.error('Uso: npx tsx scripts/diagnose.ts <caminho do .xml>')
  process.exit(1)
}

const bytes = statSync(path).size
const source = readFileSync(path, 'utf8')
console.log(`arquivo: ${path}`)
console.log(`tamanho: ${bytes} bytes`)
console.log(`BOM: ${source.charCodeAt(0) === 0xfeff ? 'sim' : 'não'}`)

let doc
try {
  doc = parseXml(path.split(/[\\/]/).pop()!, source, bytes)
} catch (error) {
  console.error(`\nPARSER FALHOU: ${(error as Error).message}`)
  process.exit(1)
}

console.log(`\nnós: ${doc.nodes.length}  raiz: ${doc.nodes[doc.root].name}`)
console.log('declaração:', doc.declaration)

const schema = detectSchema(doc)
console.log(`\nesquema: ${schema.dialect}`)
console.log(`  metadados: ${schema.metadataRoot}`)
console.log(`  dados:     ${schema.dataRoot}`)
console.log(`  colunas declaradas: ${schema.declared.size}`)

const fields = buildFieldIndex(doc, schema)
console.log(`\ncampos (${fields.length}):`)
for (const f of fields) {
  const tipo = f.isNumeric ? 'número' : f.isDate ? 'data' : 'texto'
  console.log(
    `  ${f.name.padEnd(20)} ${tipo.padEnd(7)} x${String(f.count).padEnd(4)} ` +
      `declarado ${f.declaredType ?? '—'}`,
  )
}
const numeric = numericFields(fields)
console.log(`\ntotais (${numeric.length} campos numéricos):`)
for (const field of numeric) {
  const s = computeFieldStats(doc, field)
  console.log(
    `  ${field.name.padEnd(24)} soma=${formatNumber(s.sum).padStart(16)}` +
      `  n=${String(s.count).padStart(5)}` +
      `  mín=${formatNumber(s.min).padStart(12)}` +
      `  máx=${formatNumber(s.max).padStart(12)}` +
      (s.invalid > 0 ? `  ${s.invalid} fora do total` : ''),
  )
}

const candidates = tableProfiles(doc, schema)
console.log(`\ncandidatos a Tabela: ${candidates.length}`)
for (const p of candidates) console.log(`  ${p.path} x${p.count}`)

const path0 = candidates[0]?.path
if (path0) {
  const table = buildTable(doc, path0)
  console.log(
    `\ntabela padrão: ${path0}\n  ${table.rows.length} linha(s), ${table.columns.length} coluna(s)`,
  )
  console.log('  ', table.columns.map((c) => c.key).join(' | '))
  for (const row of table.rows.slice(0, 3)) {
    console.log(
      '  ',
      table.columns.map((c) => row.cells[c.key] ?? '—').join(' | '),
    )
  }
}

console.log('\nperfis de caminho:')
for (const p of Object.values(doc.profiles)) {
  console.log(
    `  ${p.path.padEnd(34)} count=${String(p.count).padEnd(4)} repeats=${p.repeats}`,
  )
}
