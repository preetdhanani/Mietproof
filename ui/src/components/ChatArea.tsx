import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUp, Loader2, Plus, Scale } from 'lucide-react'
import type { ChatMessage, ChatSession, LiveRun } from '../types'
import type { TabId } from './diagnose/DiagnosePanel'
import { MessageBubble } from './MessageBubble'

interface ChatAreaProps {
  session: ChatSession | null
  /** the request in flight (any message) */
  live: LiveRun | null
  loading: boolean
  /** the diagnose workbench covers the chat */
  hidden: boolean
  /** the answer whose steps are being replayed (the latest question) */
  replayId: string | null
  onSubmit: (question: string) => void
  onInspect: (messageId: string, tab: TabId) => void
  onNew: () => void
  onOpenPanel: () => void
}

// Each example exercises a different path through the pipeline.
const EXAMPLES: Array<{ question: string; path: string }> = [
  { question: 'How much notice must I give before ending my lease?', path: 'full answer' },
  { question: 'Can my landlord keep my deposit?', path: 'full answer' },
  { question: 'My flat was sold - do I have a new landlord?', path: 'full answer' },
  { question: 'Can I refuse a modernization in my apartment?', path: 'full answer' },
  { question: 'What is the best pizza place in Berlin?', path: 'declined by scope gate' },
  { question: 'Wie lange ist die Kündigungsfrist für meine Wohnung?', path: 'German input' },
]

export function ChatArea({ session, live, loading, hidden, replayId, onSubmit, onInspect, onNew, onOpenPanel }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const messages = session?.messages ?? []
  // Follow the conversation as it grows (new messages, the thinking feed
  // unfolding, the answer appearing) - but only while the reader is at the
  // bottom; scrolling up to read stops the follow.
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const hasMessages = messages.length > 0
  const onScroll = () => {
    const el = scrollRef.current
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current
      if (el && following.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [hasMessages])
  // Asking a question always jumps to it. Instant on purpose: a smooth scroll
  // emits mid-way scroll events that would read as "the reader scrolled up".
  useEffect(() => {
    following.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const submit = () => {
    const question = input.trim()
    if (!question || loading) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    onSubmit(question)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
  }

  return (
    <main className={`flex-1 flex-col min-w-0 ${hidden ? 'hidden' : 'flex'}`}>
      <header className="flex items-center gap-2 h-14 shrink-0 border-b border-zinc-800 px-4">
        <button
          onClick={onNew}
          className="md:hidden rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
        <h2 className="flex-1 min-w-0 truncate text-sm font-medium text-zinc-200">
          {session && session.messages.length > 0 ? session.title : 'New chat'}
        </h2>
        <button
          onClick={onOpenPanel}
          className="xl:hidden flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-500"
        >
          <Activity className="h-3.5 w-3.5 text-emerald-400" />
          Diagnose
        </button>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 relative">
            <div
              className="absolute w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none"
              style={{ animation: 'pulse-glow 5s ease-in-out infinite' }}
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/25 to-teal-600/25 border border-emerald-500/30 mb-4 relative shadow-lg shadow-emerald-950/50">
              <Scale className="h-7 w-7 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-1 relative text-center">
              German rental law, answered in English
            </h2>
            <p className="text-sm text-zinc-400 mb-8 text-center max-w-md relative">
              Every answer cites the exact BGB paragraph it came from. Watch the backend work: retrieval scores,
              the prompt, the LLM's reasoning and the citation check stream into the <span className="text-zinc-200">Diagnose</span> panel live.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full relative">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={ex.question}
                  onClick={() => onSubmit(ex.question)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left hover:border-emerald-500/40 hover:bg-zinc-900 transition-all duration-200 hover:-translate-y-0.5 stage-enter"
                  style={{ '--stage-index': i } as React.CSSProperties}
                >
                  <span className="block text-xs text-zinc-200">{ex.question}</span>
                  <span className="mt-1 block text-[10px] font-mono text-zinc-500">→ {ex.path}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div ref={contentRef} className="py-4 max-w-3xl mx-auto">
            {messages.map((m: ChatMessage) => (
              <MessageBubble
                key={m.id}
                message={m}
                live={live?.messageId === m.id ? live : null}
                replay={m.id === replayId}
                onInspect={(tab) => onInspect(m.id, tab)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-3 py-2 focus-within:border-emerald-500/50 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask about German rental law… (English)"
              className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none py-1.5 max-h-40"
              disabled={loading}
            />
            <button
              onClick={submit}
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-opacity hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Send"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-400">
            General statutory information, not legal advice · BGB §§ 535-580a · Stand 2026-07-23
          </p>
        </div>
      </div>
    </main>
  )
}
