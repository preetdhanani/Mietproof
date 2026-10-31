import type { AskResponse } from './types'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

export async function ask(
  question: string,
  sessionId: string | null,
  debug: boolean,
  signal?: AbortSignal,
): Promise<AskResponse> {
  const response = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, session_id: sessionId, debug }),
    signal,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message =
      typeof detail?.detail === 'object'
        ? detail.detail.error ?? 'request failed'
        : detail?.detail ?? `HTTP ${response.status}`
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
  }
  return response.json()
}
