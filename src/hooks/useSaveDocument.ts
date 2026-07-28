import { useCallback, useState } from 'react'
import type { XmlDocument } from '../types/xml'
import { saveDocument } from '../lib/fs/saveDocument'
import { pushToast } from '../store/useToasts'
import { useWorkspace } from '../store/useWorkspace'

/**
 * Salvar: gravar, consolidar, avisar.
 *
 * A consolidação acontece só depois da gravação confirmada, e só quando o
 * arquivo de origem foi mesmo escrito. No caminho de download o original
 * continua intocado, então o banner de pendência permanece — limpá-lo ali
 * seria afirmar na tela algo que não aconteceu em disco.
 *
 * O overlay é fotografado antes da gravação e é essa foto que vai para a
 * consolidação. Gravar leva tempo — diálogo do sistema, permissão, escrita — e
 * o que for editado nesse intervalo não entra no arquivo; consolidar o overlay
 * ao vivo apagaria o aviso dessas edições sem que elas existissem em disco.
 */
export function useSaveDocument() {
  const [saving, setSaving] = useState(false)
  const commitDocument = useWorkspace((s) => s.commitDocument)

  const save = useCallback(
    async (doc: XmlDocument) => {
      setSaving(true)
      // `getState()` e não o hook reativo: o que importa é o overlay no
      // instante do clique, que é o mesmo que `saveDocument` vai serializar.
      const pending = useWorkspace.getState().edits[doc.id]

      try {
        const outcome = await saveDocument(doc)

        if (outcome.kind === 'saved') {
          // `outcome.fileName` sempre, não só quando `picked`: depois de um
          // "Salvar como" os salvamentos seguintes têm `picked: false` mas o
          // handle já aponta para o arquivo novo, e o nome dele é a verdade
          // sobre onde a gravação aconteceu.
          commitDocument(doc.id, outcome.bytes, pending, outcome.fileName)
          pushToast(
            'success',
            outcome.picked
              ? `Salvo em ${outcome.fileName}`
              : 'Alterações salvas com sucesso no arquivo',
          )
        } else if (outcome.kind === 'downloaded') {
          pushToast(
            'success',
            `${outcome.fileName} baixado — substitua o original manualmente.`,
          )
        }
        // `cancelled` não gera aviso: fechar o diálogo não é um erro.
      } catch (error) {
        pushToast(
          'error',
          error instanceof Error ? error.message : 'Não foi possível salvar.',
        )
      } finally {
        setSaving(false)
      }
    },
    [commitDocument],
  )

  return { save, saving }
}
