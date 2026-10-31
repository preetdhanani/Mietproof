import { useCallback, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { DiagnosePanel, type TabId } from './components/diagnose/DiagnosePanel'
import { useSessions } from './hooks/useSessions'
import { useLiveRun } from './hooks/useLiveRun'
import { askStream } from './api'
import type { ChatMessage } from './types'

export default function App() {
  const { sessions, active, activeId, setActiveId, createSession, deleteSession, appendMessage, updateMessage } =
    useSessions()
  const { run, start, push, finish } = useLiveRun()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Below xl the panel is a drawer; "wide" turns it into a full-width workbench.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const [focus, setFocus] = useState<{ tab: TabId; nonce: number } | undefined>()
  // Only the newest answer replays its steps; asking again finishes older replays.
  const [replayId, setReplayId] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (question: string) => {
      // Ensure a session exists before appending (createSession sets activeId,
      // but `active` still points at the old session in this closure).
      const session = active ?? createSession()
      appendMessage(session.id, { id: crypto.randomUUID(), role: 'user', content: question, timestamp: Date.now() })
      const assistantId = crypto.randomUUID()
      appendMessage(session.id, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() })
      setSelectedId(assistantId)
      setReplayId(assistantId)
      setFocus(undefined)
      start(session.id, assistantId, question)
      try {
        const response = await askStream(question, session.id, push)
        finish()
        updateMessage(session.id, assistantId, { content: response.answer, response })
      } catch (e) {
        const partial = finish()
        updateMessage(session.id, assistantId, {
          error: e instanceof Error ? e.message : 'request failed',
          liveTrace: partial?.trace?.stages.length ? partial.trace : undefined,
        })
      }
    },
    [active, createSession, appendMessage, updateMessage, start, push, finish],
  )

  const messages = active?.messages ?? []
  const assistants = messages.filter((m) => m.role === 'assistant')
  const selected: ChatMessage | null = assistants.find((m) => m.id === selectedId) ?? assistants.at(-1) ?? null
  const selectedLive = run && selected && run.messageId === selected.id ? run : null

  const inspect = (messageId: string, tab: TabId) => {
    setSelectedId(messageId)
    setFocus((f) => ({ tab, nonce: (f?.nonce ?? 0) + 1 }))
    setDrawerOpen(true)
  }

  const panel = (closable: boolean) => (
    <DiagnosePanel
      key={selected?.id ?? 'intro'}
      message={selected}
      live={selectedLive}
      wide={wide}
      focus={focus}
      onToggleWide={() => setWide(!wide)}
      onClose={closable ? () => (wide ? setWide(false) : setDrawerOpen(false)) : undefined}
    />
  )

  return (
    <div className="flex h-full">
      {!wide && (
        <Sidebar sessions={sessions} activeId={activeId} onSelect={setActiveId} onNew={createSession} onDelete={deleteSession} />
      )}
      <ChatArea
        session={active}
        live={run}
        loading={run !== null}
        hidden={wide}
        replayId={replayId}
        onSubmit={handleSubmit}
        onInspect={inspect}
        onNew={createSession}
        onOpenPanel={() => setDrawerOpen(true)}
      />
      {wide ? (
        <div className="min-w-0 flex-1">{panel(true)}</div>
      ) : (
        <>
          <div className="hidden w-[540px] shrink-0 border-l border-zinc-800 xl:block">{panel(false)}</div>
          {drawerOpen && (
            <div className="fixed inset-0 z-40 flex justify-end xl:hidden">
              <button className="absolute inset-0 bg-black/60 animate-fade-in" aria-label="Close panel" onClick={() => setDrawerOpen(false)} />
              <div className="relative h-full w-full max-w-[600px] border-l border-zinc-800 shadow-2xl animate-fade-in">{panel(true)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
