import { Download, FileWarning, RotateCcw } from 'lucide-react'
import type { XmlDocument } from '../../types/xml'
import { countMixedContent } from '../../lib/xml/serialize'
import { downloadXml } from '../../lib/download'
import { formatInt } from '../../lib/xml/coerce'
import { Button } from '../ui/controls'

interface Props {
  doc: XmlDocument
  editCount: number
  onRevertAll: () => void
}

/**
 * Aparece só quando há alterações pendentes. O botão de exportar vive na barra
 * superior e continua disponível sem edição nenhuma — reexportar um arquivo
 * apenas reindentado também é um uso legítimo.
 */
export function ChangesBar({ doc, editCount, onRevertAll }: Props) {
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
          title="Nós com texto e filhos ao mesmo tempo: ao exportar, o texto é escrito antes dos filhos."
        >
          <FileWarning size={13} className="text-changed" />
          {formatInt(mixed)} nó(s) com conteúdo misto serão reordenados na
          exportação
        </p>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onRevertAll}>
          <RotateCcw size={13} />
          Desfazer tudo
        </Button>
        <Button size="sm" variant="solid" onClick={() => downloadXml(doc)}>
          <Download size={13} />
          Baixar {doc.fileName}
        </Button>
      </div>
    </div>
  )
}
