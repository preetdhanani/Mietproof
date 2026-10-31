import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, ChatSession } from '../types'

const STORAGE_KEY = 'bgb-rag-sessions'
const ACTIVE_KEY = 'bgb-rag-active-session'

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const sessions = JSON.parse(raw) as ChatSession[]
    return Array.isArray(sessions) ? sessions : []
  } catch {
    return []
  }
}

// Trace fields that make up most of a trace's size; dropped first when storage is full.
const HEAVY_FIELDS = ['all_scores', 'all_paragraphs', 'messages', 'final_prompt', 'reasoning', 'sections']

/** Drop the bulky parts of traces so more history fits (views degrade gracefully). */
function slim(sessions: ChatSession[], dropTraces: boolean): ChatSession[] {
  return sessions.map((s) => ({
    ...s,
    messages: s.messages.map((m) => {
      if (!m.response?.trace) return m
      if (dropTraces) return { ...m, response: { ...m.response, trace: null } }
      const stages = m.response.trace.stages.map((st) =>
        Object.fromEntries(Object.entries(st).filter(([k]) => !HEAVY_FIELDS.includes(k))),
      ) as typeof m.response.trace.stages
      return { ...m, response: { ...m.response, trace: { ...m.response.trace, stages } } }
    }),
  }))
}

/** Persist sessions, degrading (slimmer traces, then no traces) when storage is full. */
function saveSessions(sessions: ChatSession[]) {
  const recent = sessions.slice(0, 50)
  for (const candidate of [recent, slim(recent, false), slim(recent, true)]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate))
      return
    } catch {
      // quota exceeded or storage unavailable - try a smaller payload
    }
  }
}

function newSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    created_at: Date.now(),
    updated_at: Date.now(),
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    } catch {
      // storage unavailable - the active chat just is not remembered
    }
  }, [activeId])

  const active = sessions.find((s) => s.id === activeId) ?? null

  const createSession = useCallback(() => {
    const session = newSession()
    setSessions((prev) => [session, ...prev])
    setActiveId(session.id)
    return session
  }, [])

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (activeId === id) {
        const remaining = sessions.filter((s) => s.id !== id)
        setActiveId(remaining[0]?.id ?? null)
      }
    },
    [activeId, sessions],
  )

  const appendMessage = useCallback(
    (sessionId: string, message: ChatMessage) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s
          const messages = [...s.messages, message]
          const title =
            s.messages.length === 0 && message.role === 'user'
              ? message.content.slice(0, 48) + (message.content.length > 48 ? '…' : '')
              : s.title
          return { ...s, messages, title, updated_at: Date.now() }
        }),
      )
    },
    [],
  )

  const updateMessage = useCallback((sessionId: string, messageId: string, patch: Partial<ChatMessage>) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s
        const messages = s.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m))
        return { ...s, messages, updated_at: Date.now() }
      }),
    )
  }, [])

  return {
    sessions: [...sessions].sort((a, b) => b.updated_at - a.updated_at),
    active,
    activeId,
    setActiveId,
    createSession,
    deleteSession,
    appendMessage,
    updateMessage,
  }
}
