import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, LocateFixed, Maximize2, Minimize2, Radio, X } from 'lucide-react'
import type { ChatMessage, LiveRun } from '../../types'
import { STEPS, stepStates, type StepId } from '../../lib/pipeline'
import { fmtMs } from '../../lib/text'
import type { DiagnoseData } from './data'
import { StatusIcon } from './ui'
import { OverviewTab } from './tabs/OverviewTab'
import { QueryTab } from './tabs/QueryTab'
import { Bm25Tab } from './tabs/Bm25Tab'
import { SemanticTab } from './tabs/SemanticTab'
import { FusionTab } from './tabs/FusionTab'
import { PromptTab } from './tabs/PromptTab'
import { LlmTab } from './tabs/LlmTab'
import { VerifyTab } from './tabs/VerifyTab'

export type TabId = StepId | 'overview'

interface DiagnosePanelProps {
  /** the assistant message being diagnosed; null shows the introduction */
  message: ChatMessage | null
  /** the in-flight run, when it belongs to this message */
  live: LiveRun | null
  wide: boolean
  onToggleWide?: () => void
  onClose?: () => void
  /** open a tab from outside (e.g. a click in the chat's thinking block) */
  focus?: { tab: TabId; nonce: number }
}

function Intro() {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-zinc-300">
        Ask a question and watch the backend answer it. Every step streams in here the moment it finishes: what each
        search scored and why, how the rankings are fused, the exact prompt, the model's reasoning, and every
        verification check.
      </p>
      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-zinc-800">
        {STEPS.map((s, i) => (
          <li key={s.id} className="relative flex gap-3">
            <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 font-mono text-[10px] text-zinc-300">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[13px] font-medium text-zinc-100">{s.label}</p>
              <p className="text-xs leading-snug text-zinc-400">{s.explain}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function DiagnosePanel({ message, live, wide, onToggleWide, onClose, focus }: DiagnosePanelProps) {
  const [pinned, setPinned] = useState<TabId | null>(focus?.tab ?? null)
  // Adopt an outside focus request once per nonce (derived during render).
  const [seenFocus, setSeenFocus] = useState(focus?.nonce)
  if (focus && focus.nonce !== seenFocus) {
    setSeenFocus(focus.nonce)
    setPinned(focus.tab)
  }
  const trace = live?.trace ?? message?.response?.trace ?? message?.liveTrace ?? null
  const finished = Boolean(message?.response)
  const failed = Boolean(message?.error)
  const isLive = Boolean(live) && !finished && !failed
  const steps = useMemo(
    () => stepStates(trace, finished, failed, isLive && live?.streaming !== null),
    [trace, finished, failed, isLive, live?.streaming],
  )

  // While live, follow the running step until the user picks a tab.
  const running = steps.find((s) => s.status === 'running')?.def.id
  const following = isLive && pinned === null
  const tab: TabId = pinned ?? (isLive ? (running ?? 'overview') : 'overview')

  // Keep the active tab visible in the scrollable tab bar (it moves while following live).
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  const data: DiagnoseData = {
    trace,
    steps,
    drafts: live?.drafts ?? {},
    streaming: live?.streaming ?? null,
    live: isLive,
    response: message?.response ?? null,
    error: message?.error ?? null,
    wide,
    goto: setPinned,
  }

  const tabs: Array<{ id: TabId; label: string; status?: (typeof steps)[number] }> = [
    { id: 'overview', label: 'Overview' },
    ...steps.map((s) => ({ id: s.def.id as TabId, label: s.def.label, status: s })),
  ]

  return (
    <aside className="flex h-full flex-col bg-zinc-950">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-800 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
          <Activity className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight text-zinc-100">Diagnose</h2>
          <p className="truncate text-[11px] leading-tight text-zinc-500">
            {message ? (trace?.request_id ? `request ${trace.request_id}` : 'connecting…') : 'how the backend answers'}
          </p>
        </div>
        {isLive && (
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            <Radio className="h-3 w-3 animate-pulse" />
            live
          </span>
        )}
        {onToggleWide && (
          <button
            onClick={onToggleWide}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={wide ? 'Back to chat' : 'Expand to full view'}
            title={wide ? 'Back to chat' : 'Expand to full view'}
          >
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close panel">
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {message && (
        <nav ref={navRef} className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-zinc-800 px-2 py-1.5" aria-label="Pipeline steps">
          {tabs.map((t) => {
            const active = t.id === tab
            const idle = t.status && (t.status.status === 'pending' || t.status.status === 'skipped')
            return (
              <button
                key={t.id}
                onClick={() => setPinned(t.id)}
                aria-current={active ? 'page' : undefined}
                title={t.status?.reason ?? t.status?.def.explain}
                className={`flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs transition-colors ${
                  active ? 'bg-zinc-800 text-zinc-100' : idle ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {t.status && <StatusIcon status={t.status.status} className="h-3 w-3" />}
                <span>{t.label}</span>
                {t.status && t.status.stages.length > 0 && wide && (
                  <span className="font-mono text-[10px] text-zinc-500">{fmtMs(t.status.durationMs)}</span>
                )}
              </button>
            )
          })}
          {isLive && (
            <button
              onClick={() => setPinned(null)}
              disabled={following}
              className={`ml-auto flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] ${
                following ? 'text-emerald-300' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
              title="Jump to whichever step is running"
            >
              <LocateFixed className="h-3 w-3" />
              <span className={wide ? '' : 'sr-only'}>{following ? 'following' : 'follow live'}</span>
            </button>
          )}
        </nav>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className={`px-4 py-5 ${wide ? 'mx-auto max-w-5xl px-8' : ''}`}>
          {!message ? (
            <Intro />
          ) : message.error && !trace?.stages.length ? (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              Request failed before any step ran: {message.error}
            </p>
          ) : (
            <div key={tab} className="animate-fade-in">
              {message.error && (
                <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  Request failed: {message.error}
                </p>
              )}
              {tab === 'overview' && <OverviewTab data={data} />}
              {tab === 'query' && <QueryTab data={data} />}
              {tab === 'bm25' && <Bm25Tab data={data} />}
              {tab === 'semantic' && <SemanticTab data={data} />}
              {tab === 'fusion' && <FusionTab data={data} />}
              {tab === 'prompt' && <PromptTab data={data} />}
              {tab === 'llm' && <LlmTab data={data} />}
              {tab === 'verify' && <VerifyTab data={data} />}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
