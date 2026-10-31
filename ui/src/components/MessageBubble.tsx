import { useMemo } from 'react'
import { useReveal } from '../hooks/useReveal'
import { ExternalLink, Info, Scale, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage, LiveRun } from '../types'
import { stepStates, type StepId } from '../lib/pipeline'
import { para } from '../lib/text'
import { ThinkingBlock } from './chat/ThinkingBlock'

const BEHAVIOR_LABELS: Record<string, { label: string; className: string; icon: 'ok' | 'alert' }> = {
  answer: { label: 'verified answer', className: 'border-emerald-500/25 text-emerald-300', icon: 'ok' },
  out_of_scope: { label: 'outside rental law', className: 'border-amber-500/25 text-amber-300', icon: 'alert' },
  german_input: { label: 'German input', className: 'border-zinc-600 text-zinc-300', icon: 'alert' },
  refusal: { label: 'not verified - nearest paragraphs', className: 'border-rose-500/25 text-rose-300', icon: 'alert' },
}

interface MessageBubbleProps {
  message: ChatMessage
  /** the in-flight run, when it belongs to this message */
  live: LiveRun | null
  /** this is the answer to the question just asked: replay its steps before showing it */
  replay: boolean
  onInspect: (step: StepId | 'overview') => void
}

function AssistantAvatar() {
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
      <Scale className="h-3.5 w-3.5 text-emerald-400" />
    </div>
  )
}

export function MessageBubble({ message, live, replay, onInspect }: MessageBubbleProps) {
  const trace = live?.trace ?? message.response?.trace ?? message.liveTrace ?? null
  const finished = Boolean(message.response)
  const failed = Boolean(message.error)
  const isLive = Boolean(live) && !finished && !failed
  // The stage list is the same before and after the result lands (live trace,
  // then response.trace), so the replay position carries across that switch.
  const reveal = useReveal(message.id, trace?.stages ?? [], replay && !failed, finished)
  const answerVisible = finished && reveal.done
  const active = isLive || (finished && !answerVisible)
  const steps = useMemo(
    () => stepStates(trace, finished, failed, isLive && live?.streaming !== null),
    [trace, finished, failed, isLive, live?.streaming],
  )

  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-4 py-3 animate-fade-up">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-zinc-800 px-4 py-2.5 text-sm leading-relaxed text-zinc-100">
          {message.content}
        </div>
      </div>
    )
  }

  const response = message.response
  const behavior = response ? BEHAVIOR_LABELS[response.behavior] : null

  return (
    <div className="flex px-4 py-3 animate-fade-up">
      <div className="flex w-full min-w-0 items-start gap-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1 space-y-3">
          {(trace || isLive) && (
            <ThinkingBlock
              trace={trace}
              shown={reveal.shown}
              steps={steps}
              drafts={live?.drafts ?? {}}
              streaming={live?.streaming ?? null}
              live={isLive}
              active={active}
              animate={!reveal.skipped && (reveal.animating || (replay && isLive && !failed))}
              failed={failed}
              onSkip={reveal.skip}
              onOpen={onInspect}
            />
          )}

          {message.error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{message.error}</span>
            </div>
          )}

          {response && answerVisible && (
            <div className="space-y-3 animate-fade-up">
              {behavior && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${behavior.className}`}>
                  {behavior.icon === 'ok' ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                  {behavior.label}
                </span>
              )}
              <div className="answer-markdown text-sm leading-relaxed text-zinc-200">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>

              {response.gap_note && (
                <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <p className="text-[11px] leading-relaxed text-zinc-400">{response.gap_note}</p>
                </div>
              )}

              {response.citations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Sources</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {response.citations.map((c) => (
                      <a
                        key={`${c.index}-${c.paragraph}-${c.absatz}`}
                        href={c.deep_link}
                        target="_blank"
                        rel="noreferrer"
                        className="group block rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 transition-colors hover:border-zinc-600"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-zinc-700/80 px-1 font-mono text-[10px] text-zinc-100">[{c.index}]</span>
                          <span className="font-mono text-[11px] text-zinc-200">{para(c.paragraph, c.absatz)} BGB</span>
                          <ExternalLink className="ml-auto h-3 w-3 text-zinc-600 group-hover:text-zinc-300" />
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[11px] italic leading-relaxed text-zinc-400">„{c.german_text}"</p>
                        {c.gloss_en && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{c.gloss_en}</p>}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-zinc-500">
                {response.disclaimer} · Stand {response.corpus_stand_date}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
