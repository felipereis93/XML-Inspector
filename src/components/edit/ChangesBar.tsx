import { FileWarning, RotateCcw, Save } from 'lucide-react'
import type { XmlDocument } from '../../types/xml'
import { countMixedContent } from '../../lib/xml/serialize'
import { formatInt } from '../../lib/xml/coerce'
import { Button } from '../ui/controls'

interface Props {
  doc: XmlDocument
  editCount: number
  saving: boolean
  onRevertAll: () => void
  onSave: () => void
}

/**
 * Aparece só quando há alterações pendentes, o que já garante o requisito de
 * "salvar habilitado apenas com alterações": não existe barra sem edição.
 *
 * O download não vive mais aqui — ele está no ícone da barra superior, que
 * continua disponível mesmo sem edição nenhuma, porque reexportar um arquivo
 * apenas reindentado é um uso legítimo. Deixar "Baixar" e "Salvar" lado a lado
 * só convidaria ao clique errado.
 */
export function ChangesBar({
  doc,
  editCount,
  saving,
  onRevertAll,
  onSave,
}: Props) {
  const mixed = countMixedContent(doc)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-changed/40 bg-changed/[0.08] px-4 py-2">
      <p className="text-[12.5px]">
        <span className="num font-semibold text-changed">
          {formatInt(editCount)}
        </span>{' '}
        {editCount === 1 ? 'campo alterado' : 'campos alterados'} em memória —
        o arquivo em disco não foi tocado.
      </p>

      {mixed > 0 && (
        <p
          className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]"
          title="Nós com texto e filhos ao mesmo tempo: ao salvar, o texto é escrito antes dos filhos."
        >
          <FileWarning size={13} className="text-changed" />
          {formatInt(mixed)} nó(s) com conteúdo misto serão reordenados na
          gravação
        </p>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRevertAll}
          disabled={saving}
        >
          <RotateCcw size={13} />
          Desfazer tudo
        </Button>
        <Button size="sm" variant="solid" onClick={onSave} disabled={saving}>
          <Save size={13} />
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
