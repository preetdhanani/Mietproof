import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Scale } from 'lucide-react'
import type { ChatMessage, ChatSession } from '../types'
import { MessageBubble } from './MessageBubble'

interface ChatAreaProps {
  session: ChatSession | null
  loading: boolean
  error: string | null
  onSubmit: (question: string) => void
}

const EXAMPLES = [
  'How much notice must I give before ending my lease?',
  'Can my landlord keep my deposit?',
  'Can I refuse a modernization in my apartment?',
  'My flat was sold - do I have a new landlord?',
]

export function ChatArea({ session, loading, error, onSubmit }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages.length, loading])

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
    <main className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 overflow-y-auto">
        {!session || session.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 relative">
            <div
              className="absolute w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none"
              style={{ animation: 'pulse-glow 5s ease-in-out infinite' }}
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/25 to-teal-600/25 border border-emerald-500/30 mb-4 relative shadow-lg shadow-emerald-950/50">
              <Scale className="h-7 w-7 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-1 relative">German rental law, answered in English</h2>
            <p className="text-sm text-zinc-500 mb-8 text-center max-w-md relative">
              Every answer cites the exact BGB paragraph it came from - with the pipeline's
              full thinking process visible below each response.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full relative">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={ex}
                  onClick={() => onSubmit(ex)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left text-xs text-zinc-300 hover:border-emerald-500/40 hover:bg-zinc-900 hover:text-zinc-100 transition-all duration-200 hover:-translate-y-0.5 stage-enter"
                  style={{ '--stage-index': i } as React.CSSProperties}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-4">
            {session.messages.map((m: ChatMessage) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {loading && (
              <div className="flex px-4 py-3 animate-fade-up">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 mt-0.5 animate-pulse">
                    <Scale className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <div className="rounded-2xl rounded-tl-md bg-zinc-900 border border-zinc-800 px-4 py-3">
                    <div className="flex items-center gap-2 text-xs">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                      <span className="shimmer-text font-medium">retrieving · generating · verifying citations…</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="mx-4 my-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
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
          <p className="mt-2 text-center text-[10px] text-zinc-600">
            General statutory information, not legal advice · BGB §§ 535-580a · Stand 2026-07-23
          </p>
        </div>
      </div>
    </main>
  )
}
