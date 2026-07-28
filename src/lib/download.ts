import type { XmlDocument } from '../types/xml'
import { serializeDocument, type SerializeOptions } from './xml/serialize'

/**
 * Disparo de download no navegador.
 *
 * Separado de `xml/serialize.ts` porque este arquivo toca no DOM e aquele não:
 * a serialização precisa rodar também fora do navegador, nos testes que
 * conferem o round-trip.
 */

/**
 * Gera o XML e baixa.
 *
 * O nome de saída é `doc.fileName`, sem sufixo e sem transformação nenhuma:
 * ele é o `File.name` do arquivo importado, guardado intacto desde o parsing.
 * Quem exporta espera reconhecer o próprio arquivo na pasta de downloads, e
 * qualquer decoração que a gente acrescente vira trabalho de renomear depois.
 */
export function downloadXml(
  doc: XmlDocument,
  options: SerializeOptions = {},
): void {
  downloadText(
    serializeDocument(doc, options),
    doc.fileName,
    'application/xml;charset=utf-8',
  )
}

export function downloadText(
  content: string,
  fileName: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }))

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()

  // Revogar de imediato cancela o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
