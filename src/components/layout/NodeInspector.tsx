import { useState } from 'react'
import { Check, Copy, MousePointerSquareDashed, RotateCcw } from 'lucide-react'
import type { DocumentEdits, EditTarget, XmlDocument } from '../../types/xml'
import { nodePath } from '../../lib/xml/parse'
import { declaredWidth, type DocumentSchema } from '../../lib/xml/schema'
import { serializeSubtree } from '../../lib/xml/serialize'
import { isFieldEdited, isNodeEdited, originalValue } from '../../lib/xml/edits'
import { formatDate, formatInt, formatNumber } from '../../lib/xml/coerce'
import { EditableField, EditedBadge } from '../edit/EditableField'
import { Button, EmptyState, Eyebrow } from '../ui/controls'

interface Props {
  /** Documento com edições aplicadas — é o que se vê e o que se exporta. */
  doc: XmlDocument
  /** Esquema do arquivo; fornece o `WIDTH` que limita cada campo. */
  schema: DocumentSchema
  /** Documento original, para mostrar o valor de origem no "desfazer". */
  original?: XmlDocument
  edits?: DocumentEdits
  nodeId?: number
  onEdit: (target: EditTarget, value: string) => void
  onRevertField: (target: EditTarget) => void
  onRevertNode: (nodeId: number) => void
}

/** Detalhe e edição do nó selecionado. */
export function NodeInspector({
  doc,
  schema,
  original,
  edits,
  nodeId,
  onEdit,
  onRevertField,
  onRevertNode,
}: Props) {
  const [copied, setCopied] = useState(false)

  if (nodeId === undefined || !doc.nodes[nodeId]) {
    return (
      <EmptyState
        icon={<MousePointerSquareDashed size={26} strokeWidth={1.5} />}
        title="Nenhum nó selecionado"
        hint="Clique em uma linha da árvore ou da tabela para inspecionar e editar o nó."
      />
    )
  }

  const node = doc.nodes[nodeId]
  const attrs = Object.entries(node.attrs)
  const nodeEdited = isNodeEdited(edits, nodeId)

  const copy = async () => {
    await navigator.clipboard.writeText(serializeSubtree(doc, nodeId))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const fieldProps = (target: EditTarget) => ({
    value: (target.attr === undefined ? node.value : node.attrs[target.attr]) ?? '',
    original: originalValue(original, target) ?? '',
    edited: isFieldEdited(edits, target),
    onCommit: (next: string) => onEdit(target, next),
    onRevert: () => onRevertField(target),
  })

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Caminho</Eyebrow>
          <div className="flex items-center gap-1">
            {nodeEdited && (
              <Button
                size="sm"
                className="text-changed hover:bg-changed/15"
                onClick={() => onRevertNode(nodeId)}
              >
                <RotateCcw size={13} />
                Desfazer nó
              </Button>
            )}
            <Button size="sm" onClick={copy}>
              {copied ? <Check size={13} className="text-added" /> : <Copy size={13} />}
              {copied ? 'Copiado' : 'Copiar XML'}
            </Button>
          </div>
        </div>
        <p className="rounded-md bg-[var(--surface-sunken)] px-2 py-1.5 font-mono text-[11px] leading-relaxed break-all text-[var(--fg-muted)]">
          {nodePath(doc, nodeId)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Fact label="Profundidade" value={String(node.depth)} />
        <Fact label="Filhos" value={formatInt(node.children.length)} />
        {node.num !== undefined && (
          <Fact label="Como número" value={formatNumber(node.num)} accent />
        )}
        {node.time !== undefined && (
          <Fact label="Como data" value={formatDate(node.time)} accent />
        )}
      </dl>

      {/* Texto só é editável em folha: escrever texto em um nó que tem filhos
          criaria conteúdo misto, que a exportação não consegue reposicionar. */}
      {node.children.length === 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Eyebrow>Valor</Eyebrow>
            {isFieldEdited(edits, { node: nodeId }) && <EditedBadge />}
          </div>
          <EditableField label="Valor do nó" {...fieldProps({ node: nodeId })} />
          <OriginalHint
            edits={edits}
            original={original}
            target={{ node: nodeId }}
          />
        </div>
      )}

      {attrs.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Atributos ({attrs.length})</Eyebrow>
          {attrs.map(([name]) => {
            const target: EditTarget = { node: nodeId, attr: name }
            const width = declaredWidth(schema, name)
            return (
              <div key={name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-[var(--fg-key)]">
                    {name}
                  </span>
                  {/* A largura aparece antes de digitar: descobrir o limite ao
                      esbarrar nele é pior do que saber dele de antemão. */}
                  {width !== undefined && (
                    <span className="num shrink-0 text-[10px] text-[var(--fg-subtle)]">
                      máx {width}
                    </span>
                  )}
                  {isFieldEdited(edits, target) && <EditedBadge />}
                </div>
                <EditableField
                  label={name}
                  maxLength={width}
                  inputClassName="text-[11.5px]"
                  {...fieldProps(target)}
                />
                <OriginalHint edits={edits} original={original} target={target} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Mostra o valor de origem, riscado, quando o campo está alterado. */
function OriginalHint({
  edits,
  original,
  target,
}: {
  edits?: DocumentEdits
  original?: XmlDocument
  target: EditTarget
}) {
  if (!isFieldEdited(edits, target)) return null
  const previous = originalValue(original, target)
  return (
    <p className="font-mono text-[10.5px] text-[var(--fg-subtle)]">
      original: <span className="line-through">{previous || '(vazio)'}</span>
    </p>
  )
}

function Fact({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="panel px-2.5 py-2">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={
          accent
            ? 'num mt-0.5 text-[14px] font-semibold text-brand-600'
            : 'num mt-0.5 text-[14px] font-semibold'
        }
      >
        {value}
      </dd>
    </div>
  )
}
