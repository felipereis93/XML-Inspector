/**
 * Registro de handles de escrita, por documento.
 *
 * Um `Map` de módulo e não estado do zustand: handles são objetos de navegador
 * não clonáveis, nenhum componente renderiza a partir deles, e a pergunta
 * "tenho handle para este documento?" só é feita no clique de salvar — nunca
 * durante um render.
 */

const handles = new Map<string, FileSystemFileHandle>()

/** O navegador sabe gravar em arquivo escolhido pelo usuário. */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

export function rememberHandle(
  docId: string,
  handle: FileSystemFileHandle,
): void {
  handles.set(docId, handle)
}

export function handleFor(docId: string): FileSystemFileHandle | undefined {
  return handles.get(docId)
}

export function forgetHandle(docId: string): void {
  handles.delete(docId)
}

/**
 * Garante permissão de escrita, pedindo ao usuário se necessário.
 *
 * Handles vindos de `showOpenFilePicker` nascem só com leitura, e
 * `requestPermission` abre um prompt que **exige gesto do usuário** — por isso
 * quem chama precisa estar na cadeia de ativação do clique, sem nenhum `await`
 * lento antes.
 */
export async function ensureWritable(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const
  if ((await handle.queryPermission?.(descriptor)) === 'granted') return true
  return (await handle.requestPermission?.(descriptor)) === 'granted'
}
