import { ArrowRight } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { findStage } from '../data'
import { Card, Section, Stat, StatusIcon } from '../ui'
import { useTip } from '../useTip'
import { fmtInt, fmtMs } from '../../../lib/text'
import { stepOf, summarize, type StepId } from '../../../lib/pipeline'
import { NEUTRAL } from '../../../lib/colors'

/** The retrieval funnel: how 298 chunks become the handful the LLM sees. */
function Funnel({ data }: { data: DiagnoseData }) {
  const bm25 = findStage(data.trace, 'bm25_retrieval')
  const dense = findStage(data.trace, 'dense_retrieval')
  const fusion = findStage(data.trace, 'hybrid_fusion')
  const prompt = findStage(data.trace, 'prompt_assembly')
  const citations = findStage(data.trace, 'citation_assembly')
  const nChunks = (bm25?.params as { n_chunks?: number } | undefined)?.n_chunks ?? (dense?.n_chunks as number | undefined)
  type Cell = { label: string; value: number | undefined; go: StepId }
  const cell = (label: string, value: number | undefined, go: StepId): Cell => ({ label, value, go })
  // Columns run left to right; the two searches run side by side over the same index.
  const columns: Cell[][] = [
    [cell('chunks in the index', nChunks, 'bm25')],
    [
      cell('share a word (BM25)', bm25?.matched_chunks as number | undefined, 'bm25'),
      cell('paragraphs ranked by meaning', dense?.n_paragraphs as number | undefined, 'semantic'),
    ],
    [cell('candidates fused', (fusion?.candidates as unknown[] | undefined)?.length, 'fusion')],
    [cell('chunks sent to the LLM', (prompt?.retrieved_chunks_sent as unknown[] | undefined)?.length, 'prompt')],
    [cell('verified citations', (citations?.citations as unknown[] | undefined)?.length, 'verify')],
  ]
    .map((col) => col.filter((c) => c.value !== undefined))
    .filter((col) => col.length > 0)
  if (columns.length < 2) return null
  return (
    <Section
      title="Retrieval funnel"
      hint="How the whole statute narrows down to the few passages the answer may cite. Both searches score the full index in parallel."
    >
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {columns.map((col, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col gap-1">
              {col.map((c) => (
                <button
                  key={c.label}
                  onClick={() => data.goto(c.go)}
                  className={`group flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-left transition-colors hover:border-zinc-600 ${
                    data.wide ? 'w-[7.5rem]' : 'w-[5.25rem]'
                  }`}
                >
                  <div className="font-mono text-base font-medium tabular-nums text-zinc-100">{fmtInt(c.value)}</div>
                  <div className="text-[10px] leading-snug text-zinc-500 group-hover:text-zinc-300">{c.label}</div>
                </button>
              ))}
            </div>
            {i < columns.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />}
          </div>
        ))}
      </div>
    </Section>
  )
}

/** Gantt-style waterfall: when each stage ran and how long it took. */
function Waterfall({ data }: { data: DiagnoseData }) {
  const tip = useTip()
  const stages = data.trace?.stages ?? []
  const total = Math.max(data.trace?.total_ms ?? 0, ...stages.map((s) => s.t_ms ?? 0), 1)
  if (stages.length < 2) return null
  return (
    <Section
      title="Timeline"
      hint="Each bar starts when the stage started and spans how long it ran. Retrieval takes milliseconds; the LLM takes seconds."
    >
      <Card className="relative p-3" >
        <div data-tip-root className="relative space-y-1">
          {stages.map((stage, i) => {
            const duration = stage.duration_ms ?? 0
            const start = Math.max(0, (stage.t_ms ?? 0) - duration)
            const step = stepOf(stage)
            const warn = stage.passed === false || stage.verification_passed === false || stage.stage === 'refusal'
            return (
              <button
                key={`${stage.stage}-${i}`}
                onClick={() => step && data.goto(step)}
                onMouseMove={(e) =>
                  tip.show(
                    e,
                    <>
                      <div className="font-medium text-zinc-100">{stage.stage.replaceAll('_', ' ')}</div>
                      <div className="text-zinc-400">
                        starts {fmtMs(start)} · takes {fmtMs(duration)}
                      </div>
                      <div className="mt-1 text-zinc-300">{summarize(stage)}</div>
                    </>,
                  )
                }
                onMouseLeave={tip.hide}
                className="group flex w-full items-center gap-2 rounded-md py-0.5 text-left hover:bg-zinc-800/50"
              >
                <span className="w-36 shrink-0 truncate pl-1 text-[11px] text-zinc-400 group-hover:text-zinc-200">
                  {stage.stage.replaceAll('_', ' ')}
                </span>
                <span className="relative h-3 flex-1">
                  <span className="absolute inset-y-[5px] left-0 right-0 rounded-full bg-zinc-800/60" />
                  <span
                    className="absolute inset-y-0.5 rounded-[3px]"
                    style={{
                      left: `${(start / total) * 100}%`,
                      width: `max(3px, ${(duration / total) * 100}%)`,
                      background: warn ? '#f59e0b' : NEUTRAL,
                    }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-500">{fmtMs(duration)}</span>
              </button>
            )
          })}
          {tip.node}
        </div>
        <div className="mt-2 flex justify-between pl-[9.5rem] pr-16 font-mono text-[10px] text-zinc-600">
          <span>0</span>
          <span>{fmtMs(total / 2)}</span>
          <span>{fmtMs(total)}</span>
        </div>
      </Card>
    </Section>
  )
}

export function OverviewTab({ data }: { data: DiagnoseData }) {
  const trace = data.trace
  const llmStages = (trace?.stages ?? []).filter((s) => s.stage.startsWith('generation_attempt_'))
  const ttft = llmStages[0]?.ttft_ms as number | undefined
  const usage = trace?.usage
  const checks = llmStages.at(-1)?.verification_checks as Array<{ passed: boolean }> | undefined
  const totalMs = trace?.total_ms ?? trace?.stages.at(-1)?.t_ms
  const meta = trace?.meta

  return (
    <div className="space-y-6">
      <div className={`grid gap-2 ${data.wide ? 'grid-cols-4' : 'grid-cols-2'}`}>
        <Stat label="End to end" value={data.live ? '…' : fmtMs(totalMs)} sub={data.live ? 'running' : `${trace?.stages.length ?? 0} stages`} />
        <Stat label="First LLM token" value={ttft !== undefined ? fmtMs(ttft) : '-'} sub="time to first token" />
        <Stat
          label="Tokens"
          value={usage?.total_tokens ? fmtInt(usage.total_tokens) : '-'}
          sub={usage?.prompt_tokens ? `${fmtInt(usage.prompt_tokens)} in · ${fmtInt(usage.completion_tokens)} out` : 'no LLM call yet'}
        />
        <Stat
          label="Verifier checks"
          value={checks ? `${checks.filter((c) => c.passed).length}/${checks.length}` : '-'}
          sub={llmStages.length > 1 ? `${llmStages.length} attempts` : 'passed / run'}
        />
      </div>

      <Section title="Pipeline" hint="Click a step to open its detail.">
        <ol className="space-y-1">
          {data.steps.map((s, i) => (
            <li key={s.def.id}>
              <button
                onClick={() => data.goto(s.def.id)}
                className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/50"
              >
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="w-3 font-mono text-[10px] text-zinc-600">{i + 1}</span>
                  <StatusIcon status={s.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-zinc-100">{s.def.label}</span>
                  <span className="block text-xs leading-snug text-zinc-400">
                    {s.stages.length > 0
                      ? summarize(s.stages.find((st) => st.passed === false) ?? s.stages.at(-1)!)
                      : (s.reason ?? s.def.explain)}
                  </span>
                </span>
                <span className="mt-0.5 font-mono text-[10px] tabular-nums text-zinc-500">
                  {s.stages.length > 0 ? fmtMs(s.durationMs) : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Section>

      <Funnel data={data} />
      <Waterfall data={data} />

      {meta && (
        <Section title="Configuration" hint="What served this request.">
          <Card className="divide-y divide-zinc-800/80">
            {[
              ['LLM', meta.llm_model],
              ['Retrieval backend', meta.retrieval_backend],
              ['Embedding model', meta.embedding_model],
              ['Index (collection)', meta.collection],
              ['Prompt version', meta.prompt_version],
              ['Request id', trace?.request_id],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="text-zinc-500">{k}</span>
                  <span className="truncate font-mono text-zinc-200">{v}</span>
                </div>
              ))}
          </Card>
        </Section>
      )}
    </div>
  )
}
