import type { ParseRequest, ParseResponse } from '../workers/parse.worker'
import type { ParseFailure, XmlDocument } from '../types/xml'

/**
 * Pool de workers para parsing.
 *
 * O parsing sai da thread principal por um motivo específico: um XML de 40 MB
 * leva alguns segundos e, na thread principal, isso congela até o cursor. Com
 * o pool, vários arquivos são lidos em paralelo e a interface continua
 * respondendo — inclusive para cancelar.
 */

const POOL_SIZE = Math.min(4, Math.max(1, navigator.hardwareConcurrency ?? 2))

interface Pending {
  resolve: (doc: XmlDocument) => void
  reject: (failure: ParseFailure) => void
}

class ParsePool {
  private workers: Worker[] = []
  private next = 0
  private pending = new Map<string, Pending>()

  private ensure(): void {
    if (this.workers.length) return
    for (let i = 0; i < POOL_SIZE; i++) {
      const worker = new Worker(
        new URL('../workers/parse.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.onmessage = (event: MessageEvent<ParseResponse>) => {
        const data = event.data
        const entry = this.pending.get(data.requestId)
        if (!entry) return
        this.pending.delete(data.requestId)
        if (data.ok) entry.resolve(data.doc)
        else entry.reject({ fileName: data.fileName, message: data.message })
      }
      this.workers.push(worker)
    }
  }

  parse(fileName: string, source: string, bytes: number): Promise<XmlDocument> {
    this.ensure()
    const requestId = crypto.randomUUID()
    const worker = this.workers[this.next++ % this.workers.length]

    return new Promise<XmlDocument>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      const request: ParseRequest = { requestId, fileName, source, bytes }
      worker.postMessage(request)
    })
  }

  /** Encerra os workers e rejeita o que estiver pendente. */
  dispose(): void {
    for (const worker of this.workers) worker.terminate()
    this.workers = []
    for (const [, entry] of this.pending) {
      entry.reject({ fileName: '', message: 'Leitura cancelada.' })
    }
    this.pending.clear()
  }
}

export const parsePool = new ParsePool()

export async function parseFile(file: File): Promise<XmlDocument> {
  const source = await file.text()
  return parsePool.parse(file.name, source, file.size)
}
