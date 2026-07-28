import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '../../lib/cn'
import {
  dropHandlePromises,
  pairDropHandles,
  pickXmlFiles,
  supportsOpenPicker,
  type HandleMap,
} from '../../lib/fs/pickFiles'

interface Props {
  onFiles: (files: File[], handles?: HandleMap) => void
  children: ReactNode
  className?: string
}

/**
 * Área de soltar que cobre a janela inteira.
 *
 * O alvo é a janela, não um retângulo: quando já há um documento aberto, o
 * usuário arrasta o próximo arquivo para qualquer lugar e espera que funcione.
 * O contador de `dragenter`/`dragleave` evita o piscar clássico quando o
 * ponteiro passa sobre um filho.
 */
export function DropZone({ onFiles, children, className }: Props) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const handle = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setOver(false)

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return

      // `getAsFileSystemHandle` precisa ser chamado enquanto o evento ainda
      // está vivo; as promessas sobrevivem, os itens não.
      const promises = event.dataTransfer
        ? dropHandlePromises(event.dataTransfer)
        : []

      void pairDropHandles(files, promises).then((handles) =>
        onFiles(files, handles.size ? handles : undefined),
      )
    },
    [onFiles],
  )

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth.current++
      setOver(true)
    }
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const over = (event: DragEvent) => event.preventDefault()

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', handle)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', handle)
    }
  }, [handle])

  return (
    <div className={cn('relative h-full', className)}>
      {children}
      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-sunken)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand-500 bg-[var(--surface)] px-12 py-10">
            <UploadCloud size={32} className="text-brand-500" strokeWidth={1.5} />
            <p className="font-display text-[15px] font-semibold">
              Solte os arquivos para abrir
            </p>
            <p className="text-[13px] text-[var(--fg-muted)]">
              Vários de uma vez, tudo lido no seu navegador.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Botão de seleção manual, para quem prefere o diálogo do sistema. */
export function FilePicker({
  onFiles,
  children,
  className,
}: {
  onFiles: (files: File[], handles?: HandleMap) => void
  children: ReactNode
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)

  // Usa o seletor com handle de escrita quando o navegador suporta; cai no
  // `<input>` (sem handle) quando não.
  const openPicker = async () => {
    if (!supportsOpenPicker()) {
      input.current?.click()
      return
    }
    const picked = await pickXmlFiles()
    if (picked?.files.length) onFiles(picked.files, picked.handles)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openPicker()}
        className={className}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept=".xml,text/xml,application/xml"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length) onFiles(files)
          event.target.value = ''
        }}
      />
    </>
  )
}
