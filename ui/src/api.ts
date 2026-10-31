import type { AskResponse, StreamEvent } from './types'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** Error from the API. Events streamed before the failure were already delivered. */
export class AskError extends Error {}

function errorMessage(detail: unknown, status: number): string {
  const d = (detail as { detail?: unknown } | null)?.detail
  if (typeof d === 'string') return d
  if (d && typeof d === 'object' && 'error' in d) return String((d as { error: unknown }).error)
  return `HTTP ${status}`
}

/**
 * Ask a question via the streaming endpoint. Every NDJSON event (pipeline
 * stages, LLM deltas) goes to `onEvent` as it arrives; resolves with the
 * final verified response.
 */
export async function askStream(
  question: string,
  sessionId: string | null,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<AskResponse> {
  const response = await fetch(`${API_BASE}/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, session_id: sessionId }),
    signal,
  })
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null)
    throw new AskError(errorMessage(detail, response.status))
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const event = JSON.parse(line) as StreamEvent
      if (event.type === 'result') return event.response
      if (event.type === 'error') throw new AskError(event.error)
      onEvent(event)
    }
  }
  throw new AskError('connection closed before the answer arrived')
}
