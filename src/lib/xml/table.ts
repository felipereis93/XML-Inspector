import type { EditTarget, XmlDocument } from '../../types/xml'

/**
 * Projeta nós repetidos em uma tabela.
 *
 * As colunas não são configuradas: são a união dos campos folha e atributos
 * encontrados nos próprios registros, na ordem em que aparecem no documento.
 * Um item de nota fiscal com um campo opcional a mais ganha uma coluna a mais,
 * vazia nos demais registros.
 */

export interface TableColumn {
  /** Identificador estável — caminho relativo, ou `@atributo`. */
  key: string
  label: string
  numeric: boolean
  /** Quantos registros preenchem essa coluna. */
  filled: number
}

export interface TableRow {
  /** Id do nó que representa o registro. */
  node: number
  cells: Record<string, string>
  nums: Record<string, number>
  /**
   * Origem de cada célula: qual nó e qual atributo a produziram. É o que
   * permite editar direto na grade — sem isso a célula é um texto órfão, sem
   * endereço para gravar de volta.
   */
  sources: Record<string, EditTarget>
}

export interface TableData {
  path: string
  columns: TableColumn[]
  rows: TableRow[]
  /** Colunas cortadas pelo limite. */
  omittedColumns: number
}

const MAX_COLUMNS = 80

export function buildTable(
  doc: XmlDocument | undefined,
  path: string,
  scope?: Set<number> | null,
): TableData {
  const empty: TableData = { path, columns: [], rows: [], omittedColumns: 0 }
  if (!doc || !path) return empty

  const order: string[] = []
  const filled = new Map<string, number>()
  const numericCount = new Map<string, number>()
  const rows: TableRow[] = []

  const note = (key: string) => {
    if (!filled.has(key)) {
      order.push(key)
      filled.set(key, 0)
      numericCount.set(key, 0)
    }
  }

  for (const record of doc.nodes) {
    if (record.path !== path) continue
    if (scope && !scope.has(record.id)) continue

    const cells: Record<string, string> = {}
    const nums: Record<string, number> = {}
    const sources: Record<string, EditTarget> = {}

    const collect = (id: number, prefix: string) => {
      const node = doc.nodes[id]

      for (const attr in node.attrs) {
        const key = prefix ? `${prefix}@${attr}` : `@${attr}`
        note(key)
        if (cells[key] === undefined) {
          sources[key] = { node: id, attr }
          cells[key] = node.attrs[attr]
          filled.set(key, filled.get(key)! + 1)
          const n = Number(node.attrs[attr])
          if (Number.isFinite(n) && node.attrs[attr].trim() !== '') {
            nums[key] = n
            numericCount.set(key, numericCount.get(key)! + 1)
          }
        }
      }

      if (node.children.length === 0) {
        const key = prefix || node.name
        note(key)
        // A origem é registrada mesmo sem valor: uma célula vazia continua
        // sendo um campo do registro e precisa ser editável.
        if (sources[key] === undefined) sources[key] = { node: id }
        if (node.value !== undefined && cells[key] === undefined) {
          cells[key] = node.value
          filled.set(key, filled.get(key)! + 1)
          if (node.num !== undefined) {
            nums[key] = node.num
            numericCount.set(key, numericCount.get(key)! + 1)
          }
        }
        return
      }

      for (const child of node.children) {
        const childNode = doc.nodes[child]
        collect(child, prefix ? `${prefix}.${childNode.name}` : childNode.name)
      }
    }

    for (const attr in record.attrs) {
      const key = `@${attr}`
      note(key)
      sources[key] = { node: record.id, attr }
      cells[key] = record.attrs[attr]
      filled.set(key, filled.get(key)! + 1)
    }
    for (const child of record.children) {
      collect(child, doc.nodes[child].name)
    }

    rows.push({ node: record.id, cells, nums, sources })
  }

  const columns: TableColumn[] = order.slice(0, MAX_COLUMNS).map((key) => {
    const fill = filled.get(key) ?? 0
    return {
      key,
      label: key,
      filled: fill,
      numeric: fill > 0 && (numericCount.get(key) ?? 0) / fill >= 0.9,
    }
  })

  return {
    path,
    columns,
    rows,
    omittedColumns: Math.max(0, order.length - MAX_COLUMNS),
  }
}

/** Soma de uma coluna numérica, para o rodapé da tabela. */
export function columnTotal(rows: TableRow[], key: string): number {
  let total = 0
  for (const row of rows) {
    const n = row.nums[key]
    if (n !== undefined) total += n
  }
  return total
}

export function toCsv(table: TableData): string {
  const escape = (value: string) =>
    /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

  const header = table.columns.map((c) => escape(c.label)).join(';')
  const body = table.rows
    .map((row) =>
      table.columns.map((c) => escape(row.cells[c.key] ?? '')).join(';'),
    )
    .join('\n')

  return `${header}\n${body}`
}
