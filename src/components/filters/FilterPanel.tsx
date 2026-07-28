import { useMemo } from 'react'
import { Filter as FilterIcon, Plus, X } from 'lucide-react'
import type {
  FieldKind,
  Filter,
  FilterOperator,
  XmlField,
} from '../../types/xml'
import { acceptsMultiple, emptyFilter, isComplete } from '../../lib/xml/filters'
import { findField, kindOf } from '../../lib/xml/fields'
import { declaredWidth, type DocumentSchema } from '../../lib/xml/schema'
import { formatDate, formatInt, formatNumber } from '../../lib/xml/coerce'
import { Button, Eyebrow, IconButton, Select } from '../ui/controls'
import { ValueChips } from './ValueChips'
import { cn } from '../../lib/cn'

interface Props {
  fields: XmlField[]
  schema: DocumentSchema
  filters: Filter[]
  matchCount?: number
  onAdd: (filter: Filter) => void
  onUpdate: (id: string, patch: Partial<Filter>) => void
  onRemove: (id: string) => void
}

const TEXT_OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: 'contém' },
  { value: 'equals', label: 'é igual a' },
  { value: 'starts', label: 'começa com' },
]

/**
 * Operadores por tipo de campo.
 *
 * Os operadores de texto aparecem sempre, inclusive em campo numérico. A
 * detecção de tipo erra em um caso previsível — um código totalmente numérico,
 * como CNPJ ou conta contábil, é lido como número — e retirar "começa com" de
 * um campo desses tornaria o filtro inútil justamente onde ele mais serve.
 */
const OPERATORS: Record<FieldKind, Array<{ value: FilterOperator; label: string }>> = {
  text: [...TEXT_OPERATORS, { value: 'exists', label: 'está preenchido' }],
  number: [
    ...TEXT_OPERATORS,
    { value: 'gt', label: 'maior que' },
    { value: 'gte', label: 'maior ou igual a' },
    { value: 'lt', label: 'menor que' },
    { value: 'lte', label: 'menor ou igual a' },
    { value: 'between', label: 'entre' },
    { value: 'exists', label: 'está preenchido' },
  ],
  date: [
    ...TEXT_OPERATORS,
    { value: 'gte', label: 'a partir de' },
    { value: 'lte', label: 'até' },
    { value: 'between', label: 'entre' },
    { value: 'exists', label: 'está preenchido' },
  ],
}

export function FilterPanel({
  fields,
  schema,
  filters,
  matchCount,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  // Só conta filtro que de fato restringe: um filtro pela metade não deveria
  // aparecer como badge ativo e fazer o usuário procurar o que ele escondeu.
  const activeCount = filters.filter((f) => f.enabled && isComplete(f)).length

  const groups = useMemo(() => {
    const byGroup = new Map<string, Filter[]>()
    for (const filter of filters) {
      const bucket = byGroup.get(filter.group)
      if (bucket) bucket.push(filter)
      else byGroup.set(filter.group, [filter])
    }
    return [...byGroup.entries()].map(([id, rows]) => ({ id, rows }))
  }, [filters])

  const options = useMemo(
    () => ({
      declared: fields.filter((f) => f.declared),
      attribute: fields.filter((f) => !f.declared && f.source === 'attribute'),
      element: fields.filter((f) => !f.declared && f.source === 'element'),
    }),
    [fields],
  )

  return (
    <section className="flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eyebrow>Filtros</Eyebrow>
          {activeCount > 0 && (
            <span className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={fields.length === 0}
          onClick={() => onAdd(emptyFilter())}
        >
          <Plus size={13} />
          Adicionar
        </Button>
      </header>

      {filters.length === 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-dashed border-[var(--hairline)] px-3 py-3 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
          <FilterIcon size={14} className="mt-0.5 shrink-0" />
          Escolha um campo, um operador e um ou mais valores. O filtro esconde o
          que não casa; a busca no topo realça sem esconder nada.
        </p>
      ) : (
        <>
          {groups.map((group, index) => (
            <div key={group.id} className="flex flex-col gap-2">
              {index > 0 && <Connector label="E" />}

              {/* A barra verde à esquerda amarra visualmente as linhas que se
                  combinam por OU, sem precisar desenhar uma caixa. */}
              <div className="flex flex-col gap-2 border-l-2 border-brand-200 pl-2">
                {group.rows.map((filter, row) => (
                  <div key={filter.id} className="flex flex-col gap-2">
                    {row > 0 && <Connector label="OU" subtle />}
                    <FilterRow
                      filter={filter}
                      fields={fields}
                      schema={schema}
                      options={options}
                      onUpdate={onUpdate}
                      onRemove={onRemove}
                    />
                  </div>
                ))}

                <Button
                  size="sm"
                  className="self-start text-brand-600"
                  onClick={() => onAdd(emptyFilter(group.id))}
                >
                  <Plus size={12} />
                  OU
                </Button>
              </div>
            </div>
          ))}

          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => onAdd(emptyFilter())}
          >
            <Plus size={12} />E (novo grupo)
          </Button>

          {matchCount !== undefined && (
            <p className="text-[11.5px] text-[var(--fg-muted)]">
              <span className="num font-semibold text-[var(--fg)]">
                {formatInt(matchCount)}
              </span>{' '}
              nós visíveis
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** Rótulo de ligação entre linhas (OU) e entre grupos (E). */
function Connector({ label, subtle }: { label: string; subtle?: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <span
        className={cn(
          'num rounded px-1.5 py-px text-[10px] font-semibold',
          subtle
            ? 'bg-brand-50 text-brand-700'
            : 'bg-[var(--surface-raised)] text-[var(--fg-muted)] ring-1 ring-[var(--hairline)]',
        )}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-[var(--hairline)]" />
    </div>
  )
}

interface OptionGroups {
  declared: XmlField[]
  attribute: XmlField[]
  element: XmlField[]
}

function FilterRow({
  filter,
  fields,
  schema,
  options,
  onUpdate,
  onRemove,
}: {
  filter: Filter
  fields: XmlField[]
  schema: DocumentSchema
  options: OptionGroups
  onUpdate: (id: string, patch: Partial<Filter>) => void
  onRemove: (id: string) => void
}) {
  const field = findField(fields, filter.field, filter.source)
  const operators = OPERATORS[filter.kind]
  const incomplete = filter.enabled && !isComplete(filter)
  const multi = acceptsMultiple(filter.op)
  const width =
    field?.source === 'attribute' ? declaredWidth(schema, field.name) : undefined

  /**
   * Trocar de campo pode invalidar o operador — "contém" não faz sentido em um
   * campo de data. Se o operador atual não existe no novo tipo, cai no primeiro
   * da lista, e os valores são zerados para não carregar termo de outro campo.
   */
  const pickField = (id: string) => {
    const next = fields.find((f) => f.id === id)
    if (!next) {
      onUpdate(filter.id, { field: '', source: 'any', kind: 'text', values: [] })
      return
    }
    const kind = kindOf(next)
    const keepOp = OPERATORS[kind].some((o) => o.value === filter.op)
    onUpdate(filter.id, {
      field: next.name,
      source: next.source,
      kind,
      op: keepOp ? filter.op : OPERATORS[kind][0].value,
      values: [],
      min: undefined,
      max: undefined,
    })
  }

  return (
    <div
      className={cn(
        'panel flex flex-col gap-2 p-2.5',
        !filter.enabled && 'opacity-50',
        incomplete && 'border-changed/50',
      )}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filter.enabled}
          onChange={(e) => onUpdate(filter.id, { enabled: e.target.checked })}
          className="size-3.5 shrink-0 accent-[var(--color-brand-500)]"
          aria-label="Ativar filtro"
        />

        <Select
          value={field?.id ?? ''}
          onChange={(e) => pickField(e.target.value)}
          aria-label="Campo"
          className="h-7 text-[12px]"
        >
          <option value="">Escolha um campo…</option>
          <FieldOptions label="Colunas do arquivo" fields={options.declared} />
          <FieldOptions label="Atributos" fields={options.attribute} />
          <FieldOptions label="Tags" fields={options.element} />
        </Select>

        <IconButton
          label="Remover filtro"
          className="size-7 shrink-0"
          onClick={() => onRemove(filter.id)}
        >
          <X size={14} />
        </IconButton>
      </div>

      <div className={cn('flex gap-2', multi ? 'flex-col' : 'items-center')}>
        <Select
          value={filter.op}
          onChange={(e) =>
            onUpdate(filter.id, { op: e.target.value as FilterOperator })
          }
          aria-label="Operador"
          className={cn('h-7 text-[12px]', !multi && 'w-36 shrink-0')}
          disabled={!field}
        >
          {operators.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </Select>

        {multi ? (
          <ValueChips
            values={filter.values}
            onChange={(values) => onUpdate(filter.id, { values })}
            placeholder={field?.samples[0] ?? 'valor…'}
            label="Valores"
            disabled={!field}
            maxLength={width}
          />
        ) : (
          <BoundControls filter={filter} field={field} onUpdate={onUpdate} />
        )}
      </div>

      <FieldHint field={field} filter={filter} width={width} />
    </div>
  )
}

function FieldOptions({ label, fields }: { label: string; fields: XmlField[] }) {
  if (fields.length === 0) return null
  return (
    <optgroup label={label}>
      {fields.map((field) => (
        <option key={field.id} value={field.id}>
          {field.name}
          {field.count > 0 ? ` (${formatInt(field.count)})` : ' (vazio)'}
        </option>
      ))}
    </optgroup>
  )
}

/** Entradas dos operadores de faixa: nenhuma, um limite, ou os dois. */
function BoundControls({
  filter,
  field,
  onUpdate,
}: {
  filter: Filter
  field?: XmlField
  onUpdate: (id: string, patch: Partial<Filter>) => void
}) {
  if (filter.op === 'exists') {
    return (
      <span className="flex-1 text-[11.5px] text-[var(--fg-subtle)]">
        sem valor a informar
      </span>
    )
  }

  if (filter.op === 'between') {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <BoundInput
          kind={filter.kind}
          value={filter.min}
          placeholder={boundLabel(field?.min, filter.kind, 'de')}
          onChange={(min) => onUpdate(filter.id, { min })}
        />
        <span className="shrink-0 text-[var(--fg-subtle)]">–</span>
        <BoundInput
          kind={filter.kind}
          value={filter.max}
          placeholder={boundLabel(field?.max, filter.kind, 'até')}
          onChange={(max) => onUpdate(filter.id, { max })}
        />
      </div>
    )
  }

  const upper = filter.op === 'lt' || filter.op === 'lte'
  return (
    <BoundInput
      kind={filter.kind}
      value={upper ? filter.max : filter.min}
      placeholder={boundLabel(
        upper ? field?.max : field?.min,
        filter.kind,
        'valor',
      )}
      onChange={(next) =>
        onUpdate(filter.id, upper ? { max: next } : { min: next })
      }
    />
  )
}

function BoundInput({
  kind,
  value,
  placeholder,
  onChange,
}: {
  kind: FieldKind
  value?: number
  placeholder: string
  onChange: (value?: number) => void
}) {
  const asDate = kind === 'date'
  return (
    <input
      type={asDate ? 'date' : 'number'}
      step="any"
      value={
        value === undefined
          ? ''
          : asDate
            ? new Date(value).toISOString().slice(0, 10)
            : String(value)
      }
      placeholder={placeholder}
      aria-label="Valor"
      onChange={(e) => {
        const raw = e.target.value
        if (!raw) return onChange(undefined)
        const parsed = asDate ? Date.parse(raw) : Number(raw)
        onChange(Number.isFinite(parsed) ? parsed : undefined)
      }}
      className="num h-7 min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-raised)] px-2 text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-brand-500"
    />
  )
}

/** Faixa observada, contagem de valores e avisos do campo. */
function FieldHint({
  field,
  filter,
  width,
}: {
  field?: XmlField
  filter: Filter
  width?: number
}) {
  if (!field) return null

  const range =
    field.min !== undefined && field.max !== undefined
      ? filter.kind === 'date'
        ? `${formatDate(field.min)} – ${formatDate(field.max)}`
        : filter.kind === 'number'
          ? `${formatNumber(field.min)} – ${formatNumber(field.max)}`
          : undefined
      : undefined

  const ambiguous = field.paths.length > 1
  const mismatch =
    field.declaredType !== undefined &&
    ((filter.kind === 'number' && field.declaredType === 'string') ||
      (filter.kind === 'text' && field.declaredType !== 'string'))
  const multiple = acceptsMultiple(filter.op) && filter.values.length > 1

  if (!range && !ambiguous && !mismatch && !multiple && width === undefined) {
    return null
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-[var(--fg-subtle)]">
      {multiple && (
        <span className="font-medium text-brand-600">
          casa qualquer um dos {filter.values.length} valores
        </span>
      )}
      {range && <span className="num">{range}</span>}
      {width !== undefined && <span className="num">máx {width}</span>}
      {mismatch && (
        <span>
          o arquivo declara <span className="font-mono">{field.declaredType}</span>;
          os valores são {filter.kind === 'number' ? 'numéricos' : 'texto'}
        </span>
      )}
      {ambiguous && (
        <span title={field.paths.join('\n')}>
          o nome ocorre em {field.paths.length} caminhos — o filtro cobre todos
        </span>
      )}
    </p>
  )
}

function boundLabel(
  bound: number | undefined,
  kind: FieldKind,
  fallback: string,
): string {
  if (bound === undefined) return fallback
  if (kind === 'date') return formatDate(bound)
  return String(bound)
}
