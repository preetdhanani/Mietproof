// The RAG pipeline as a fixed sequence of steps, mapped from the raw trace
// stages the backend emits (app/trace.py), plus plain-English summaries.

import type { PipelineTrace, TraceStage } from '../types'
import { fmtInt, fmtMs, para } from './text'

export type StepId = 'query' | 'bm25' | 'semantic' | 'fusion' | 'prompt' | 'llm' | 'verify'

export interface StepDef {
  id: StepId
  label: string
  /** what this step does, for someone new to RAG */
  explain: string
}

export const STEPS: StepDef[] = [
  {
    id: 'query',
    label: 'Query',
    explain: 'Detects German input, rewrites follow-ups, and adds German legal terms for the semantic search.',
  },
  {
    id: 'bm25',
    label: 'BM25',
    explain: 'Keyword search: scores every statute chunk by the words it shares with the question.',
  },
  {
    id: 'semantic',
    label: 'Semantic',
    explain: 'Embeds the question as a vector, ranks paragraphs by cosine similarity, then checks the scope gate.',
  },
  {
    id: 'fusion',
    label: 'Fusion',
    explain: 'Reciprocal rank fusion merges both rankings; the top 5 chunks go to the LLM.',
  },
  {
    id: 'prompt',
    label: 'Prompt',
    explain: 'Builds the exact messages the LLM receives: answer rules, the chunks, the question.',
  },
  {
    id: 'llm',
    label: 'LLM',
    explain: 'The model reasons, then writes an English answer citing chunks as [1], [2]…',
  },
  {
    id: 'verify',
    label: 'Verify',
    explain: 'Every [n] reference and German quote is checked against the chunks before the answer is shown.',
  },
]

export function stepOf(stage: TraceStage): StepId | null {
  const name = stage.stage
  if (name.startsWith('generation_attempt_')) return 'llm'
  switch (name) {
    case 'german_input_detection':
    case 'follow_up_rewrite':
    case 'follow_up_rewrite_result':
    case 'query_enrichment':
      return 'query'
    case 'bm25_retrieval':
      return 'bm25'
    case 'dense_retrieval':
    case 'retrieval':
    case 'out_of_scope_floor':
    case 'out_of_scope_response':
      return 'semantic'
    case 'hybrid_fusion':
      return 'fusion'
    case 'prompt_assembly':
      return 'prompt'
    case 'citation_assembly':
    case 'refusal':
      return 'verify'
    default:
      return null
  }
}

/** done: ran fine · warn: ran and changed the outcome (declined, retried) ·
 * fail: failed · running: in progress · pending: not reached yet ·
 * skipped: the request finished without needing it */
export type StepStatus = 'done' | 'warn' | 'fail' | 'running' | 'pending' | 'skipped'

export interface StepState {
  def: StepDef
  status: StepStatus
  durationMs: number
  stages: TraceStage[]
  /** why a skipped step did not run */
  reason?: string
}

export function stepStates(
  trace: PipelineTrace | null,
  finished: boolean,
  failed: boolean,
  llmStreaming = false,
): StepState[] {
  const states: StepState[] = STEPS.map((def) => ({ def, status: 'pending', durationMs: 0, stages: [] }))
  const byId = new Map(states.map((s) => [s.def.id, s]))
  const stages = trace?.stages ?? []
  for (const stage of stages) {
    const id = stepOf(stage)
    if (!id) continue
    const state = byId.get(id)!
    state.stages.push(stage)
    state.durationMs += stage.duration_ms ?? 0
    if (state.status === 'pending') state.status = 'done'
    if (stage.stage === 'out_of_scope_floor' && stage.passed === false) state.status = 'warn'
    if (stage.stage === 'german_input_detection') state.status = 'warn'
    if (stage.stage.startsWith('generation_attempt_') && stage.verification_passed === false) state.status = 'warn'
    if (stage.stage === 'refusal') state.status = 'fail'
  }
  // A failed draft also counts as a (failed) verification, even before Verify's own stage.
  const verify = byId.get('verify')!
  const rejected = stages.some((s) => s.stage.startsWith('generation_attempt_') && s.verification_passed === false)
  if (rejected && verify.status === 'pending' && !finished) verify.status = 'warn'

  const german = stages.some((s) => s.stage === 'german_input_detection')
  const declined = stages.some((s) => s.stage === 'out_of_scope_response')
  const lastSeen = Math.max(-1, ...states.map((s, i) => (s.status !== 'pending' ? i : -1)))
  states.forEach((s, i) => {
    if (s.status !== 'pending') return
    if (finished) {
      s.status = 'skipped'
      s.reason = german
        ? 'German input gets a fixed reply - nothing is searched'
        : declined
          ? 'the scope gate declined the question, so the LLM was never called'
          : s.def.id === 'bm25' || s.def.id === 'fusion'
            ? 'not part of the configured retrieval backend'
            : 'not needed for this request'
    } else if (failed) {
      s.status = i === lastSeen + 1 ? 'fail' : 'skipped'
      s.reason = 'the request failed before this step'
    } else if (i === lastSeen + 1) {
      s.status = 'running'
    }
  })
  // While the LLM streams, its step is running (a retry streams after a "warn" attempt).
  if (llmStreaming && !finished && !failed) byId.get('llm')!.status = 'running'
  return states
}

export function attemptOf(stage: TraceStage): number {
  return parseInt(stage.stage.replace('generation_attempt_', ''), 10) || 1
}

function first<T>(xs: unknown): T | undefined {
  return Array.isArray(xs) ? (xs[0] as T) : undefined
}

/** One sentence that tells a non-expert what this stage did. */
export function summarize(stage: TraceStage): string {
  const name = stage.stage
  if (name.startsWith('generation_attempt_')) {
    const usage = (stage.usage ?? {}) as { total_tokens?: number }
    const tokens = usage.total_tokens ? ` · ${fmtInt(usage.total_tokens)} tokens` : ''
    if (stage.verification_passed) return `Answer drafted in ${fmtMs(stage.duration_ms)}${tokens}`
    const failures = (stage.verification_failures ?? []) as string[]
    return `Draft rejected by the verifier (${failures[0] ?? 'citation mismatch'}) - retrying with feedback`
  }
  switch (name) {
    case 'german_input_detection':
      return 'Question looks German - fixed English reply, no search and no LLM call'
    case 'follow_up_rewrite':
      return 'Follow-up detected - the LLM turns it into a standalone question'
    case 'follow_up_rewrite_result':
      return stage.fell_back
        ? 'The model returned no rewrite - searching with the question as typed'
        : `Rewritten: "${String(stage.rewritten)}"`
    case 'query_enrichment': {
      const unique = [...new Set((stage.terms_added ?? []) as string[])]
      return unique.length
        ? `Added German terms for the semantic search: ${unique.slice(0, 3).join(', ')}${unique.length > 3 ? '…' : ''}`
        : 'No lexicon terms matched - searched as written'
    }
    case 'bm25_retrieval': {
      const matched = stage.matched_chunks as number | undefined
      const best = first<{ paragraph: string; score: number }>(stage.candidates)
      if (matched === 0) return 'No statute chunk shares a word with the question'
      if (matched !== undefined && best)
        return `${matched} chunks share words with the question; best ${para(best.paragraph)} (${best.score.toFixed(2)})`
      return best ? `Best word overlap: ${para(best.paragraph)} (${best.score.toFixed(2)})` : 'No keyword matches'
    }
    case 'dense_retrieval': {
      const best = first<{ paragraph: string; heading: string; paragraph_cosine: number }>(stage.rows)
      return best
        ? `Closest meaning: ${para(best.paragraph)} ${best.heading} (cosine ${best.paragraph_cosine.toFixed(3)})`
        : 'Dense ranking computed'
    }
    case 'retrieval':
      return `Retrieved with ${String(stage.backend)}`
    case 'hybrid_fusion': {
      const rows = (stage.final_ranking ?? []) as Array<{ paragraph: string }>
      return `Top ${rows.length} after fusion: ${rows.map((r) => para(r.paragraph)).join(', ')}`
    }
    case 'out_of_scope_floor': {
      const c = (stage.confidence as number).toFixed(3)
      const floor = stage.floor as number | null
      if (floor === null) return `Confidence ${c} - no floor configured, answering`
      return stage.passed
        ? `Scope gate passed: confidence ${c} ≥ ${floor.toFixed(3)}`
        : `Scope gate declined: confidence ${c} < ${floor.toFixed(3)}`
    }
    case 'out_of_scope_response':
      return 'Replied with the covered topics - no LLM call, no tokens spent'
    case 'prompt_assembly': {
      const n = ((stage.retrieved_chunks_sent ?? []) as unknown[]).length
      const retry = ((stage.sections ?? []) as Array<{ kind: string }>).some((s) => s.kind === 'feedback')
      return `${n} chunks + answer rules${stage.gap_annotation_injected ? ' + scope note' : ''}${retry ? ' + verifier feedback' : ''} sent to the LLM`
    }
    case 'citation_assembly': {
      const n = ((stage.citations ?? []) as unknown[]).length
      return `All checks passed - ${n} citation${n === 1 ? '' : 's'} built from chunk metadata`
    }
    case 'refusal':
      return 'Verification failed twice - nearest paragraphs shown instead of an unverified answer'
    default:
      return stage.note ?? ''
  }
}

/** Short summary for the thinking header. */
export function traceHeadline(trace: PipelineTrace): string {
  const parts: string[] = []
  if (trace.total_ms !== undefined) parts.push(fmtMs(trace.total_ms))
  if (trace.usage?.total_tokens) parts.push(`${fmtInt(trace.usage.total_tokens)} tokens`)
  return parts.join(' · ')
}
