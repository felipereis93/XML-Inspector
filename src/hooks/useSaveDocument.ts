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
 */
export function useSaveDocument() {
  const [saving, setSaving] = useState(false)
  const commitDocument = useWorkspace((s) => s.commitDocument)

  const save = useCallback(
    async (doc: XmlDocument) => {
      setSaving(true)
      try {
        const outcome = await saveDocument(doc)

        if (outcome.kind === 'saved') {
          commitDocument(doc.id, outcome.bytes)
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
