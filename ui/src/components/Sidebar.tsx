import { MessageSquare, Plus, Trash2, Scale } from 'lucide-react'
import type { ChatSession } from '../types'

interface SidebarProps {
  sessions: ChatSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ sessions, activeId, onSelect, onNew, onDelete }: SidebarProps) {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b border-zinc-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
          <Scale className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100 leading-tight">BGB Rental Law</h1>
          <p className="text-[10px] text-zinc-500">RAG assistant · every step traced</p>
        </div>
      </div>

      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-zinc-600 text-center">No conversations yet</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
              s.id === activeId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
            onClick={() => onSelect(s.id)}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="flex-1 truncate text-xs">{s.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 transition-opacity"
              aria-label="Delete chat"
            >
              <Trash2 className="h-3 w-3 text-zinc-500 hover:text-rose-400" />
            </button>
          </div>
        ))}
      </nav>

      <div className="border-t border-zinc-800 px-4 py-3">
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          General statutory information only - not legal advice. Corpus: BGB §§ 535-580a.
        </p>
      </div>
    </aside>
  )
}
