/**
 * Partes da File System Access API ausentes do `lib.dom` do TypeScript 6.
 *
 * `FileSystemFileHandle` e `createWritable()` já vêm da lib padrão; o que falta
 * são os seletores, a negociação de permissão e o handle vindo de drag-drop.
 * Todos declarados como opcionais de propósito: a API não existe em Firefox
 * nem Safari, e o `?` obriga cada ponto de uso a checar antes de chamar.
 */

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FilePickerAcceptType {
    description?: string
    accept: Record<string, string[]>
  }

  interface OpenFilePickerOptions {
    multiple?: boolean
    excludeAcceptAllOption?: boolean
    types?: FilePickerAcceptType[]
  }

  interface SaveFilePickerOptions {
    suggestedName?: string
    excludeAcceptAllOption?: boolean
    types?: FilePickerAcceptType[]
  }

  interface FileSystemHandle {
    queryPermission?(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>
    requestPermission?(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>
  }

  interface Window {
    showOpenFilePicker?(
      options?: OpenFilePickerOptions,
    ): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(
      options?: SaveFilePickerOptions,
    ): Promise<FileSystemFileHandle>
  }

  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
  }
}

export {}
