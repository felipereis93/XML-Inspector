/**
 * Conversão de texto XML para número e data.
 *
 * Deliberadamente conservador: só converte quando a string inteira é o valor.
 * Um campo como "R$ 1.234,56 (à vista)" fica como texto, porque somar isso
 * silenciosamente produziria um total errado sem nenhum aviso.
 */

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/
const GROUPED_NUMBER = /^[+-]?\d{1,3}([.,]\d{3})*([.,]\d+)?$/
/**
 * Identificador preenchido com zeros à esquerda: NCM `09012100`, CST `00`,
 * CEP `01402000`, matrícula `0000000629`. Somar isso é sempre erro, então
 * esses valores ficam como texto.
 *
 * A ausência de separador decimal é o que separa código de medida. Exportações
 * de ERP alinham valores monetários à direita com zeros — `00000000003675.13`
 * é R$ 3.675,13, não um código — e uma regra que olhasse só o zero inicial
 * jogaria a folha de pagamento inteira fora da totalização.
 */
const PADDED_CODE = /^[+-]?0\d+$/

/**
 * Lê um número aceitando o formato XML canônico (`1234.56`) e o brasileiro
 * (`1.234,56`). O separador decimal é decidido pelo último separador presente.
 */
export function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (!s || s.length > 32) return undefined
  if (PADDED_CODE.test(s)) return undefined

  if (PLAIN_NUMBER.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) ? n : undefined
  }

  if (!GROUPED_NUMBER.test(s)) return undefined

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let normalized: string

  if (lastComma > lastDot) {
    // 1.234,56 — vírgula decimal.
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    // 1,234.56 — ponto decimal.
    normalized = s.replace(/,/g, '')
  } else {
    normalized = s
  }

  const n = Number(normalized)
  return Number.isFinite(n) ? n : undefined
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})( \d{2}:\d{2}(:\d{2})?)?$/

/** Lê uma data ISO 8601 ou `dd/MM/yyyy` e devolve epoch ms. */
export function toTime(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (s.length < 8 || s.length > 32) return undefined

  if (ISO_DATE.test(s)) {
    const t = Date.parse(s)
    return Number.isNaN(t) ? undefined : t
  }

  const br = BR_DATE.exec(s)
  if (br) {
    const [, d, m, y, time] = br
    const t = Date.parse(`${y}-${m}-${d}${time ? 'T' + time.trim() : ''}`)
    return Number.isNaN(t) ? undefined : t
  }

  return undefined
}

const decimalFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const intFmt = new Intl.NumberFormat('pt-BR')

/**
 * Número por extenso, no padrão pt-BR: ponto para milhar, vírgula para
 * decimal.
 *
 * Sem notação compacta em lugar nenhum. Abreviar para "25,1 mi" economiza
 * espaço e destrói o dado: a diferença entre 25.148.932,45 e 25.149.000,00 é
 * exatamente o que uma conferência contábil procura, e some na abreviação.
 * Quando o número não couber, quem se ajusta é a tipografia, não o valor.
 *
 * Inteiros ficam sem casas decimais — uma contagem de 853 registros vira
 * "853", não "853,00".
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return intFmt.format(n)
  return decimalFmt.format(n)
}

/**
 * Número com duas casas fixas, para os totais monetários. `formatNumber`
 * suprime a parte decimal de inteiros, o que numa coluna de valores faria
 * "1.200" e "1.200,50" desalinharem.
 */
export function formatDecimal(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return decimalFmt.format(n)
}

export function formatInt(n: number): string {
  return intFmt.format(n)
}

export function formatDate(t: number): string {
  return new Date(t).toLocaleDateString('pt-BR')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
