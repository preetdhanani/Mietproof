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
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY))

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(-50)))
  }, [sessions])

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
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

  const updateLastAssistant = useCallback(
    (sessionId: string, response: import('../types').AskResponse) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s
          const messages = [...s.messages]
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
              messages[i] = { ...messages[i], content: response.answer, response }
              break
            }
          }
          return { ...s, messages, updated_at: Date.now() }
        }),
      )
    },
    [],
  )

  return {
    sessions: [...sessions].sort((a, b) => b.updated_at - a.updated_at),
    active,
    activeId,
    setActiveId,
    createSession,
    deleteSession,
    appendMessage,
    updateLastAssistant,
  }
}
