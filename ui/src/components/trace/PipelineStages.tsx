import { CheckCircle2, XCircle, FileText, ShieldCheck, Quote, ShieldAlert } from 'lucide-react'
import type { TraceStage } from '../../types'
import { StageCard } from './StageCard'

export function FloorStage({ stage }: { stage: TraceStage }) {
  const passed = stage.passed as boolean
  const floor = stage.floor as number | null
  return (
    <StageCard
      title="Out-of-scope floor check"
      subtitle={floor !== null ? `calibrated floor: ${floor}` : 'no floor configured'}
      icon={passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      accent={passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}
      badge={passed ? 'pass' : 'below floor'}
    >
      <div className="text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">confidence:</span>
          <span className="font-mono text-zinc-200">{(stage.confidence as number).toFixed(4)}</span>
          {floor !== null && (
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden relative max-w-40">
              <div
                className={`h-full rounded-full ${passed ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{ width: `${Math.min(100, ((stage.confidence as number) / 1) * 100)}%` }}
              />
              <div className="absolute top-0 bottom-0 w-px bg-zinc-400" style={{ left: `${floor * 100}%` }} />
            </div>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 italic">{stage.note as string}</p>
      </div>
    </StageCard>
  )
}

interface SentChunk {
  index: number
  paragraph: string
  absatz: string
  text: string
}

export function PromptStage({ stage }: { stage: TraceStage }) {
  const chunks = (stage.retrieved_chunks_sent ?? []) as SentChunk[]
  const gap = stage.gap_annotation_injected as string | null
  return (
    <StageCard
      title="Final prompt to the LLM"
      subtitle="exactly what the model receives"
      icon={<FileText className="h-4 w-4" />}
      accent="bg-indigo-500/15 text-indigo-400"
      badge={`${chunks.length} chunks`}
      defaultOpen
    >
      <div className="space-y-2">
        <div className="space-y-1">
          {chunks.map((c) => (
            <div key={c.index} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
                  [{c.index}]
                </span>
                <span className="font-mono text-[11px] text-zinc-400">
                  § {c.paragraph} BGB{c.absatz ? ` Abs. ${c.absatz}` : ''}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed max-h-24 overflow-y-auto">{c.text}</p>
            </div>
          ))}
        </div>
        {gap && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2">
            <span className="text-[10px] font-medium text-amber-400">gap annotation injected</span>
            <p className="text-[11px] text-zinc-400 mt-1">{gap}</p>
          </div>
        )}
        <details className="group">
          <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300">
            show full prompt text
          </summary>
          <pre className="mt-1 text-[10px] leading-relaxed text-zinc-400 bg-zinc-950 rounded-lg p-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
            {stage.final_prompt as string}
          </pre>
        </details>
      </div>
    </StageCard>
  )
}

export function GenerationStage({ stage, attempt }: { stage: TraceStage; attempt: number }) {
  const passed = stage.verification_passed as boolean
  return (
    <StageCard
      title={`Generation attempt ${attempt}`}
      subtitle="LLM response + citation verification"
      icon={passed ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
      accent={passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}
      badge={passed ? 'verified' : 'rejected'}
    >
      <div className="space-y-2">
        <p className="text-[11px] text-zinc-300 bg-zinc-800/60 rounded-lg p-2 max-h-32 overflow-y-auto">
          {stage.answer as string}
        </p>
        {!passed && (stage.verification_failures as string[]).length > 0 && (
          <ul className="text-[11px] text-rose-400 space-y-0.5">
            {(stage.verification_failures as string[]).map((f, i) => (
              <li key={i}>· {f}</li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-zinc-500 italic">{stage.note as string}</p>
      </div>
    </StageCard>
  )
}

export function CitationsStage({ stage }: { stage: TraceStage }) {
  const citations = (stage.citations ?? []) as Array<{
    index: number
    paragraph: string
    absatz: string
    german_text: string
    gloss_en: string
    deep_link: string
  }>
  return (
    <StageCard
      title="Citation assembly"
      subtitle="from chunk metadata only - the model never emits § numbers"
      icon={<Quote className="h-4 w-4" />}
      accent="bg-emerald-500/15 text-emerald-400"
      badge={`${citations.length} citations`}
    >
      <div className="space-y-1.5">
        {citations.map((c) => (
          <a
            key={`${c.index}-${c.paragraph}`}
            href={c.deep_link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 hover:border-emerald-500/40 transition-colors"
          >
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
              [{c.index}]
            </span>
            <span className="font-mono text-[11px] text-zinc-300">
              § {c.paragraph} BGB{c.absatz && c.absatz !== '0' ? ` Abs. ${c.absatz}` : ''}
            </span>
            <ShieldCheck className="h-3 w-3 text-emerald-500 ml-auto shrink-0" />
          </a>
        ))}
      </div>
    </StageCard>
  )
}
