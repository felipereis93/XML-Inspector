/**
 * Abertura de arquivos com captura do handle de escrita.
 *
 * O `<input type=file>` e o `dataTransfer.files` entregam `File` somente
 * leitura, o que basta para ler mas nunca para gravar de volta. Quando o
 * navegador suporta, pegamos o handle no mesmo gesto em que o arquivo é
 * escolhido — é a única oportunidade: depois não há como pedir o handle de um
 * `File` que já se tem em mãos.
 */

import { XML_FILE_TYPES } from './fileTypes'

export type HandleMap = Map<File, FileSystemFileHandle>

export function supportsOpenPicker(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

/**
 * Abre o seletor do sistema. `undefined` significa que o usuário cancelou —
 * quem chama não deve mostrar erro nenhum.
 */
export async function pickXmlFiles(): Promise<
  { files: File[]; handles: HandleMap } | undefined
> {
  const picker = window.showOpenFilePicker
  if (!picker) return undefined

  let handles: FileSystemFileHandle[]
  try {
    handles = await picker.call(window, { multiple: true, types: XML_FILE_TYPES })
  } catch {
    return undefined
  }

  const files: File[] = []
  const map: HandleMap = new Map()
  for (const handle of handles) {
    const file = await handle.getFile()
    files.push(file)
    map.set(file, handle)
  }
  return { files, handles: map }
}

/**
 * Promessas de handle de um drop, colhidas **de forma síncrona**.
 *
 * `DataTransferItem` fica inválido assim que o handler do evento retorna, então
 * `getAsFileSystemHandle()` precisa ser chamado antes de qualquer `await`. As
 * promessas resultantes podem ser aguardadas depois, à vontade.
 */
export function dropHandlePromises(
  dataTransfer: DataTransfer,
): Promise<FileSystemHandle | null>[] {
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFileSystemHandle?.() ?? Promise.resolve(null))
}

/**
 * Casa cada arquivo com seu handle por posição: `dataTransfer.items` filtrado
 * por `kind === 'file'` tem a mesma ordem de `dataTransfer.files`.
 */
export async function pairDropHandles(
  files: File[],
  promises: Promise<FileSystemHandle | null>[],
): Promise<HandleMap> {
  const settled = await Promise.all(
    promises.map((promise) => promise.catch(() => null)),
  )
  const map: HandleMap = new Map()
  files.forEach((file, i) => {
    const handle = settled[i]
    if (handle && handle.kind === 'file') {
      map.set(file, handle as FileSystemFileHandle)
    }
  })
  return map
}
