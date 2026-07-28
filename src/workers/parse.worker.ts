/// <reference lib="webworker" />
import { parseXml } from '../lib/xml/parse'
import type { XmlDocument } from '../types/xml'

export interface ParseRequest {
  requestId: string
  fileName: string
  bytes: number
  source: string
}

export type ParseResponse =
  | { requestId: string; ok: true; doc: XmlDocument }
  | { requestId: string; ok: false; fileName: string; message: string }

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { requestId, fileName, source, bytes } = event.data
  try {
    const doc = parseXml(fileName, source, bytes, { stripNamespaces: false })
    const response: ParseResponse = { requestId, ok: true, doc }
    self.postMessage(response)
  } catch (error) {
    const response: ParseResponse = {
      requestId,
      ok: false,
      fileName,
      message: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
