import { useState, type ReactNode } from 'react'
import { ChevronDown, FastForward, Loader2, Sparkles } from 'lucide-react'
import type { Draft, PipelineTrace, TraceStage } from '../../types'
import { attemptOf, stepOf, summarize, type StepId, type StepState } from '../../lib/pipeline'
import { fmtInt, fmtMs } from '../../lib/text'
import { StatusIcon } from '../diagnose/ui'
import { Bm25Thought, GateThought, PromptThought, QueryThought, SemanticThought, VerifyThought } from './thinking/Visuals'
import { RerankThought } from './thinking/RerankThought'

interface ThinkingBlockProps {
  trace: PipelineTrace | null
  /** how many trace stages the replay has shown so far */
  shown: number
  steps: StepState[]
  drafts: Record<number, Draft>
  streaming: number | null
  /** the request is still running on the backend */
  live: boolean
  /** the feed is still working (request running or replay not finished) */
  active: boolean
  /** play the step animations */
  animate: boolean
  failed: boolean
  onSkip?: () => void
  onOpen: (step: StepId | 'overview') => void
}

const TITLES: Record<string, string> = {
  german_input_detection: 'Language check',
  follow_up_rewrite: 'Follow-up detected',
  follow_up_rewrite_result: 'Rewritten question',
  query_enrichment: 'Understanding the question',
  bm25_retrieval: 'Keyword search (BM25)',
  dense_retrieval: 'Semantic search (embeddings)',
  retrieval: 'Retrieval',
  hybrid_fusion: 'Re-ranking (fusion)',
  out_of_scope_floor: 'Scope gate',
  out_of_scope_response: 'Declined',
  prompt_assembly: 'Building the prompt',
  citation_assembly: 'Verifying citations',
  refusal: 'Refused',
}

function titleOf(stage: TraceStage): string {
  if (stage.stage.startsWith('generation_attempt_')) return `LLM answer · attempt ${attemptOf(stage)}`
  return TITLES[stage.stage] ?? stage.stage.replaceAll('_', ' ')
}

function statusOf(stage: TraceStage) {
  if (stage.stage === 'refusal') return 'fail' as const
  if (stage.passed === false || stage.verification_passed === false || stage.stage === 'german_input_detection') return 'warn' as const
  return 'done' as const
}

/** The body under a step: the real queries and results for that stage. */
function Body({ stage, trace, animate }: { stage: TraceStage; trace: PipelineTrace | null; animate: boolean }) {
  switch (stage.stage) {
    case 'query_enrichment':
      return <QueryThought stage={stage} animate={animate} />
    case 'bm25_retrieval':
      return <Bm25Thought stage={stage} animate={animate} />
    case 'dense_retrieval':
      return <SemanticThought stage={stage} animate={animate} />
    case 'hybrid_fusion':
      return <RerankThought stage={stage} trace={trace} animate={animate} />
    case 'out_of_scope_floor':
      return <GateThought stage={stage} animate={animate} />
    case 'prompt_assembly':
      return <PromptThought stage={stage} trace={trace} animate={animate} />
    case 'citation_assembly': {
      const gens = (trace?.stages ?? []).filter((s) => s.stage.startsWith('generation_attempt_'))
      const checks = (gens.at(-1)?.verification_checks ?? []) as Array<{ kind: string; target: string; passed: boolean; detail: string }>
      return <VerifyThought checks={checks} animate={animate} />
    }
    default:
      if (stage.stage.startsWith('generation_attempt_')) return <GenerationBody stage={stage} animate={animate} />
      return <p className="text-zinc-400">{summarize(stage)}</p>
  }
}

function GenerationBody({ stage, animate }: { stage: TraceStage; animate: boolean }) {
  const reasoning = (stage.reasoning as string | undefined) ?? ''
  const failures = (stage.verification_failures ?? []) as string[]
  const usage = (stage.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-zinc-400">
        first token after {fmtMs(stage.ttft_ms as number | undefined)} · finished in {fmtMs(stage.duration_ms)}
        {usage.prompt_tokens ? ` · ${fmtInt(usage.prompt_tokens)} tokens in, ${fmtInt(usage.completion_tokens)} out` : ''}
      </p>
      {reasoning && <Reasoning text={reasoning} defaultOpen={animate} />}
      {!stage.verification_passed && failures.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-amber-300">
          {failures.map((f) => (
            <li key={f}>· {f} - asking the model again with this feedback</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Reasoning({ text, defaultOpen }: { text: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-[11px] text-zinc-500 hover:text-zinc-300">
        {open ? 'Hide' : 'Show'} the model's reasoning
      </button>
      {open && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-zinc-800 pl-2 italic leading-relaxed text-zinc-500">{text}</p>}
    </div>
  )
}

function Node({ icon, title, ms, onOpen, children }: { icon: ReactNode; title: string; ms?: string; onOpen?: () => void; children?: ReactNode }) {
  return (
    <li className="relative pl-6 animate-fade-up">
      <span className="absolute left-0 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-950">{icon}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-zinc-200">{title}</span>
        {ms && <span className="font-mono text-[10px] text-zinc-600">{ms}</span>}
        {onOpen && (
          <button onClick={onOpen} className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-200">
            details →
          </button>
        )}
      </div>
      {children && <div className="mt-1.5">{children}</div>}
    </li>
  )
}

/** The last part of a growing text, so the live view shows what is new. */
function tail(text: string, chars: number) {
  return text.length > chars ? '…' + text.slice(text.length - chars) : text
}

/**
 * DeepSeek-style thinking feed: every pipeline step with the real query it
 * ran and what it found - keyword hits, semantic hits, the re-ranking, the
 * prompt, the model's reasoning, the checks - shown one by one, then the
 * answer below it.
 */
export function ThinkingBlock({
  trace,
  shown,
  steps,
  drafts,
  streaming,
  live,
  active,
  animate,
  failed,
  onSkip,
  onOpen,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(active)
  const stages = (trace?.stages ?? []).slice(0, shown)
  const caughtUp = shown >= (trace?.stages.length ?? 0)
  const draft = streaming !== null ? drafts[streaming] : undefined
  const totalMs = trace?.total_ms
  const current = active && stages.length > 0 ? titleOf(stages.at(-1)!) : null
  const waitingOn = steps.find((s) => s.status === 'running')

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 hover:border-zinc-700"
        >
          {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" /> : <Sparkles className="h-3.5 w-3.5 text-zinc-400" />}
          <span className={active ? 'shimmer-text font-medium' : 'font-medium text-zinc-300'}>
            {active
              ? (current ?? 'Thinking…')
              : `${failed ? 'Stopped' : 'Thought'}${totalMs !== undefined ? ` for ${fmtMs(totalMs)}` : ''} · ${trace?.stages.length ?? 0} step${trace?.stages.length === 1 ? '' : 's'}`}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {active && animate && onSkip && (
          <button onClick={onSkip} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200">
            <FastForward className="h-3 w-3" /> skip
          </button>
        )}
      </div>
      {/* screen readers hear the step names only, not every number */}
      <span className="sr-only" aria-live="polite">
        {active ? (current ?? '') : failed ? 'Request stopped' : 'Answer ready'}
      </span>

      {open && (
        <ol className="relative mt-3 ml-2 space-y-4 overflow-x-clip before:absolute before:bottom-1 before:left-[7px] before:top-1 before:w-px before:bg-zinc-800">
          {stages.map((stage, i) => {
            const step = stepOf(stage)
            return (
              <Node
                key={`${stage.stage}-${i}`}
                icon={<StatusIcon status={statusOf(stage)} className="h-3.5 w-3.5" />}
                title={titleOf(stage)}
                ms={fmtMs(stage.duration_ms)}
                onOpen={step ? () => onOpen(step) : undefined}
              >
                <Body stage={stage} trace={trace} animate={animate} />
              </Node>
            )
          })}

          {live && caughtUp && draft && (
            <Node icon={<Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-300" />} title="LLM is answering" onOpen={() => onOpen('llm')}>
              {draft.reasoning && <p className="whitespace-pre-wrap italic leading-relaxed text-zinc-500">{tail(draft.reasoning, 480)}</p>}
              <p className="mt-1 text-[11px] text-zinc-400">
                {draft.content ? `writing the answer… ${fmtInt(draft.content.length)} characters (checked before it is shown)` : 'reasoning…'}
              </p>
            </Node>
          )}
          {live && caughtUp && !draft && (
            <Node icon={<Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-300" />} title={waitingOn ? `${waitingOn.def.label}…` : 'Connecting to the backend…'} />
          )}
          {animate && !caughtUp && (
            <li className="pl-6 text-[11px] text-zinc-600">replaying the backend's steps at reading speed - real timings shown on each step</li>
          )}
          {!active && (
            <li className="pl-6">
              <button onClick={() => onOpen('overview')} className="text-[11px] text-emerald-400/90 hover:text-emerald-300">
                Open the full diagnosis →
              </button>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}
