import { User, Scale, ExternalLink, ShieldCheck, ShieldAlert, Info } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '../types'
import { TracePanel } from './trace/TracePanel'

const BEHAVIOR_LABELS: Record<string, { label: string; className: string }> = {
  answer: { label: 'verified answer', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  out_of_scope: { label: 'out of scope', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  german_input: { label: 'German input', className: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  refusal: { label: 'refused (verification failed)', className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-4 py-3 animate-fade-up">
        <div className="flex items-start gap-2.5 max-w-[75%]">
          <div className="rounded-2xl rounded-tr-md bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-2.5 text-sm text-white leading-relaxed shadow-lg shadow-emerald-950/40">
            {message.content}
          </div>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 mt-0.5">
            <User className="h-3.5 w-3.5 text-zinc-400" />
          </div>
        </div>
      </div>
    )
  }

  const response = message.response
  const behavior = response ? BEHAVIOR_LABELS[response.behavior] : null

  return (
    <div className="flex px-4 py-3 animate-fade-up">
      <div className="flex items-start gap-2.5 max-w-[85%] w-full">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/25 to-teal-600/25 border border-emerald-500/30 mt-0.5 shadow-sm shadow-emerald-950/50">
          <Scale className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {behavior && response && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${behavior.className}`}>
              {response.behavior === 'refusal' ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
              {behavior.label}
            </span>
          )}
          <div className="rounded-2xl rounded-tl-md bg-gradient-to-b from-zinc-900 to-zinc-900/80 border border-zinc-800 px-4 py-3 shadow-xl shadow-black/20">
            <div className="answer-markdown text-sm text-zinc-200 leading-relaxed">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>

            {response?.gap_note && (
              <div className="mt-3 flex gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5">
                <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-zinc-400 leading-relaxed">{response.gap_note}</p>
              </div>
            )}

            {response && response.citations.length > 0 && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-2">Citations</p>
                <div className="space-y-1.5">
                  {response.citations.map((c) => (
                    <a
                      key={`${c.index}-${c.paragraph}-${c.absatz}`}
                      href={c.deep_link}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-2.5 hover:border-emerald-500/40 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                          [{c.index}]
                        </span>
                        <span className="font-mono text-[11px] text-zinc-300">
                          § {c.paragraph} BGB{c.absatz && c.absatz !== '0' ? ` Abs. ${c.absatz}` : ''}
                        </span>
                        <ExternalLink className="h-3 w-3 text-zinc-600 group-hover:text-emerald-400 ml-auto" />
                      </div>
                      <p className="mt-1.5 text-[11px] text-zinc-400 italic leading-relaxed line-clamp-2">
                        "{c.german_text}"
                      </p>
                      {c.gloss_en && (
                        <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed line-clamp-2">{c.gloss_en}</p>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {response?.trace && response.trace.stages.length > 0 && (
            <div className="pl-1">
              <TracePanel stages={response.trace.stages} />
            </div>
          )}

          {response && (
            <p className="text-[10px] text-zinc-400">
              {response.disclaimer} · Stand {response.corpus_stand_date} · request {response.request_id}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
