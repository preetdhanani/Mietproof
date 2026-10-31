import { useCallback, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { useSessions } from './hooks/useSessions'
import { ask } from './api'
import type { ChatMessage } from './types'

export default function App() {
  const {
    sessions,
    active,
    activeId,
    setActiveId,
    createSession,
    deleteSession,
    appendMessage,
    updateLastAssistant,
  } = useSessions()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (question: string) => {
      setError(null)
      // Ensure a session exists before appending (createSession sets activeId,
      // but `active` still points at the old session in this closure).
      const session = active ?? createSession()
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: question,
        timestamp: Date.now(),
      }
      appendMessage(session.id, userMessage)
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }
      appendMessage(session.id, assistantMessage)
      setLoading(true)
      try {
        const response = await ask(question, session.id, true)
        updateLastAssistant(session.id, response)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'request failed')
      } finally {
        setLoading(false)
      }
    },
    [active, createSession, appendMessage, updateLastAssistant],
  )

  // Hide the empty assistant placeholder while loading or after an error.
  const visibleSession = active
    ? {
        ...active,
        messages: active.messages.filter((m) => !(m.role === 'assistant' && m.content === '')),
      }
    : null

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={createSession}
        onDelete={deleteSession}
      />
      <ChatArea session={visibleSession} loading={loading} error={error} onSubmit={handleSubmit} />
    </div>
  )
}
