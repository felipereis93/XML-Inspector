import { Sigma, TriangleAlert } from 'lucide-react'
import type { GroupedStats, Stats, XmlDocument, XmlField } from '../../types/xml'
import { useAggregation } from '../../hooks/useXmlAnalysis'
import { formatDecimal, formatInt } from '../../lib/xml/coerce'
import { EmptyState, Eyebrow, Select } from '../ui/controls'
import { cn } from '../../lib/cn'

interface Props {
  doc?: XmlDocument
  fields: XmlField[]
  metricFieldId?: string
  groupFieldId?: string
  scope: Set<number> | null
  onMetricChange: (fieldId?: string) => void
  onGroupChange: (fieldId?: string) => void
}

/**
 * Painel de totais.
 *
 * O usuário escolhe um campo; a soma, a média, o mínimo, o máximo e a contagem
 * saem juntos, porque na prática ninguém quer só a soma — quer a soma e a
 * ordem de grandeza que a valida. Valores que não puderam ser lidos como
 * número aparecem explicitamente: um total silenciosamente incompleto é pior
 * do que nenhum total.
 */
export function MetricsPanel({
  doc,
  fields,
  metricFieldId,
  groupFieldId,
  scope,
  onMetricChange,
  onGroupChange,
}: Props) {
  const { numeric, valueField, stats, candidates, grouped } = useAggregation(
    doc,
    fields,
    metricFieldId,
    groupFieldId,
    scope,
  )

  if (!doc) return null

  if (numeric.length === 0) {
    return (
      <EmptyState
        icon={<Sigma size={26} strokeWidth={1.5} />}
        title="Nenhum campo numérico detectado"
        hint="Um campo entra na lista quando pelo menos 90% dos seus valores preenchidos são lidos como número."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Campo numérico</Eyebrow>
        <Select
          value={valueField?.id ?? ''}
          onChange={(event) => onMetricChange(event.target.value || undefined)}
        >
          <option value="">Selecione um campo…</option>
          {numeric.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name} · {formatInt(field.count)} ocorrências
            </option>
          ))}
        </Select>
        {valueField && <FieldOrigin field={valueField} />}
      </div>

      {!valueField ? (
        <p className="rounded-lg border border-dashed border-[var(--hairline)] px-3 py-6 text-center text-[13px] text-[var(--fg-muted)]">
          Escolha um campo para ver soma, média, mínimo, máximo e contagem.
        </p>
      ) : (
        <>
          <StatGrid stats={stats} />

          <div className="flex flex-col gap-1.5">
            <Eyebrow>Agrupar por</Eyebrow>
            <Select
              value={groupFieldId ?? ''}
              onChange={(event) => onGroupChange(event.target.value || undefined)}
            >
              <option value="">Sem agrupamento</option>
              {candidates.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </Select>
          </div>

          {groupFieldId && <GroupTable rows={grouped} />}
        </>
      )}
    </div>
  )
}

/** De onde o campo vem — atributo ou tag, e o que o esquema declarou. */
function FieldOrigin({ field }: { field: XmlField }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 truncate font-mono text-[10.5px] text-[var(--fg-subtle)]">
      <span>{field.source === 'attribute' ? 'atributo' : 'tag'}</span>
      {field.declaredType && <span>· declarado {field.declaredType}</span>}
      <span className="truncate">· {field.paths[0] ?? '—'}</span>
    </p>
  )
}

/**
 * Escolhe o corpo da fonte pelo comprimento do número já formatado.
 *
 * A largura útil é conhecida: o painel tem 320px, então sobram cerca de 264px
 * no card da soma e 116px nos secundários. Em fonte monoespaçada cada dígito
 * ocupa ~0,6em, o que torna a conta determinística — não precisa medir o DOM
 * nem arriscar um segundo passe de layout a cada recálculo de total.
 *
 * Os limites cobrem até `Number.MAX_SAFE_INTEGER` formatado com centavos
 * (24 caracteres), que é o maior valor que a soma pode assumir sem perder
 * precisão de qualquer forma.
 */
function sizeFor(value: string, strong?: boolean): string {
  if (strong) {
    if (value.length <= 14) return 'text-[26px] leading-8'
    if (value.length <= 17) return 'text-[22px] leading-7'
    if (value.length <= 21) return 'text-[18px] leading-6'
    return 'text-[15px] leading-5'
  }
  if (value.length <= 12) return 'text-[15px] leading-5'
  if (value.length <= 15) return 'text-[13px] leading-4'
  return 'text-[11px] leading-4'
}

function StatGrid({ stats }: { stats: Stats }) {
  /**
   * A soma ocupa a linha inteira; mínimo e máximo dividem a de baixo. São dois
   * cards secundários para duas colunas, então a grade fecha sem sobra — um
   * terceiro card secundário voltaria a deixar meia linha vazia.
   */
  const cards: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: 'Soma', value: formatDecimal(stats.sum), strong: true },
    { label: 'Mínimo', value: formatDecimal(stats.min) },
    { label: 'Máximo', value: formatDecimal(stats.max) },
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((card) => (
          <div
            key={card.label}
            className={cn(
              'panel overflow-hidden px-3 py-2.5',
              card.strong && 'col-span-2 border-brand-500 bg-brand-50',
            )}
          >
            <p className="eyebrow">{card.label}</p>
            <p
              // O valor nunca é abreviado, então quem cede é a tipografia.
              title={card.value}
              className={cn(
                'num mt-1 font-display font-semibold tabular-nums',
                sizeFor(card.value, card.strong),
                card.strong ? 'text-brand-600' : 'text-[var(--fg)]',
              )}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
        <span className="num font-semibold text-[var(--fg)]">
          {formatInt(stats.count)}
        </span>
        ocorrências somadas
        {stats.invalid > 0 && (
          <span className="ml-auto flex items-center gap-1 text-changed">
            <TriangleAlert size={12} />
            {formatInt(stats.invalid)} fora do total
          </span>
        )}
      </p>
    </div>
  )
}

function GroupTable({ rows }: { rows: GroupedStats[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--fg-muted)]">
        Nenhum registro tem esse campo preenchido.
      </p>
    )
  }

  return (
    <div className="panel overflow-hidden">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--hairline)] text-left">
            <th className="eyebrow px-3 py-2 font-semibold">Chave</th>
            <th className="eyebrow px-3 py-2 text-right font-semibold">Qtd</th>
            <th className="eyebrow px-3 py-2 text-right font-semibold">Soma</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-[var(--hairline)] last:border-0"
            >
              <td className="relative max-w-0 px-3 py-1.5">
                {/* A barra de participação vive atrás do texto: comparar o peso
                    de cada chave não deveria custar uma coluna a mais. */}
                <span
                  className="absolute inset-y-0 left-0 bg-brand-100"
                  style={{ width: `${Math.max(row.share, 0) * 100}%` }}
                  aria-hidden
                />
                <span className="relative block truncate" title={row.key}>
                  {row.key}
                </span>
              </td>
              <td className="num px-3 py-1.5 text-right text-[var(--fg-muted)]">
                {formatInt(row.count)}
              </td>
              <td className="num px-3 py-1.5 text-right font-medium whitespace-nowrap">
                {formatDecimal(row.sum)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
