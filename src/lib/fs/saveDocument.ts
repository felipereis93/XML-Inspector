import type { XmlDocument } from '../../types/xml'
import { serializeDocument } from '../xml/serialize'
import { downloadText } from '../download'
import {
  ensureWritable,
  forgetHandle,
  handleFor,
  rememberHandle,
  supportsFileSystemAccess,
} from './handles'

/**
 * Gravação do documento no arquivo de origem.
 *
 * Três caminhos, em ordem de preferência: o handle guardado da abertura (grava
 * sem diálogo), o `showSaveFilePicker` (o usuário escolhe onde, e o handle
 * passa a valer para os próximos salvamentos) e, sem a API, o download.
 *
 * `cancelled` é um desfecho normal, não um erro: fechar o diálogo não deve
 * gerar aviso nenhum. Falha de gravação vira `SaveError` com mensagem pronta
 * para a tela.
 */

export type SaveOutcome =
  | { kind: 'saved'; fileName: string; bytes: number; picked: boolean }
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'cancelled' }

export class SaveError extends Error {}

const XML_TYPE = 'application/xml;charset=utf-8'

export async function saveDocument(doc: XmlDocument): Promise<SaveOutcome> {
  const xml = serializeDocument(doc)
  const bytes = new TextEncoder().encode(xml).length

  const known = handleFor(doc.id)
  if (known) {
    if (!(await ensureWritable(known))) {
      throw new SaveError(`Permissão de escrita negada para ${known.name}.`)
    }
    await write(known, xml, doc.id)
    return { kind: 'saved', fileName: known.name, bytes, picked: false }
  }

  const picker = supportsFileSystemAccess() ? window.showSaveFilePicker : undefined
  if (!picker) {
    downloadText(xml, doc.fileName, XML_TYPE)
    return { kind: 'downloaded', fileName: doc.fileName }
  }

  let handle: FileSystemFileHandle
  try {
    handle = await picker.call(window, {
      suggestedName: doc.fileName,
      types: [{ description: 'Arquivo XML', accept: { 'application/xml': ['.xml'] } }],
    })
  } catch (error) {
    if (isAbort(error)) return { kind: 'cancelled' }
    throw new SaveError(`Não foi possível salvar: ${messageOf(error)}`)
  }

  if (!(await ensureWritable(handle))) {
    throw new SaveError(`Permissão de escrita negada para ${handle.name}.`)
  }
  await write(handle, xml, doc.id)
  rememberHandle(doc.id, handle)
  return { kind: 'saved', fileName: handle.name, bytes, picked: true }
}

/**
 * Escreve e fecha. Qualquer falha descarta o handle: o arquivo pode ter sido
 * movido ou apagado, e insistir no mesmo handle repetiria o erro para sempre.
 * Sem ele, o próximo salvamento reabre o diálogo.
 */
async function write(
  handle: FileSystemFileHandle,
  xml: string,
  docId: string,
): Promise<void> {
  try {
    const stream = await handle.createWritable()
    await stream.write(xml)
    await stream.close()
  } catch (error) {
    forgetHandle(docId)
    throw new SaveError(`Não foi possível salvar: ${messageOf(error)}`)
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
