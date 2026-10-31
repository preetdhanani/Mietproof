// Compact visuals for the chat's thinking feed: what each step searched
// for and what it found. All values are the real ones from the trace.

import type { ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import type { PipelineTrace, TraceStage } from '../../../types'
import { ARM } from '../../../lib/colors'
import { fmtInt, para } from '../../../lib/text'
import { anim } from './anim'

/** One ranked hit: rank, §, growing bar, value. */
export function HitRow({
  rank,
  label,
  value,
  fraction,
  color,
  note,
  animate,
  delay,
}: {
  rank: number
  label: string
  value: string
  fraction: number
  color: string
  note?: ReactNode
  animate: boolean
  delay: number
}) {
  const row = anim(animate, 'animate-fade-up', delay)
  const bar = anim(animate, 'animate-grow-x', delay + 120)
  return (
    <div className={`flex items-center gap-2 ${row.className}`} style={row.style}>
      <span className="w-4 shrink-0 text-right font-mono text-[10px] text-zinc-500">{rank}</span>
      <span className="w-[5.5rem] shrink-0 truncate font-mono text-[11px] text-zinc-200">{label}</span>
      <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <span
          className={`block h-full rounded-full ${bar.className}`}
          style={{ ...bar.style, width: `${Math.max(3, Math.min(100, fraction * 100))}%`, background: color }}
        />
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-300">{value}</span>
      {note && <span className="hidden w-28 shrink-0 truncate text-[10px] text-zinc-500 sm:block">{note}</span>}
    </div>
  )
}

export function QueryThought({ stage, animate }: { stage: TraceStage; animate: boolean }) {
  const added = [...new Set((stage.terms_added ?? []) as string[])]
  return (
    <div className="space-y-1.5">
      <p className="text-zinc-300">
        Searching for <span className="text-zinc-100">"{String(stage.original)}"</span>
      </p>
      {added.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-zinc-500">+ German legal terms for the semantic search:</span>
          {added.map((t, i) => {
            const a = anim(animate, 'animate-pop-in', 150 + i * 120)
            return (
              <span key={t} className={`rounded border border-zinc-700 bg-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-100 ${a.className}`} style={a.style}>
                {t}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Bm25Candidate {
  rank: number
  paragraph: string
  absatz: string
  score: number
  terms?: Array<{ term: string; tf: number }>
}

export function Bm25Thought({ stage, animate }: { stage: TraceStage; animate: boolean }) {
  const tokens = [...new Set((stage.query_tokens ?? []) as string[])]
  const idf = (stage.idf ?? {}) as Record<string, number>
  const hits = ((stage.candidates ?? []) as Bm25Candidate[]).filter((c) => c.score > 0).slice(0, 3)
  const params = stage.params as { n_chunks?: number } | undefined
  const matched = stage.matched_chunks as number | undefined
  const max = Math.max(...hits.map((h) => h.score), 0.001)
  return (
    <div className="space-y-2">
      {tokens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-zinc-500">query words:</span>
          {tokens.map((t, i) => {
            const a = anim(animate, 'animate-pop-in', i * 60)
            return (
              <span
                key={t}
                className={`rounded px-1 font-mono text-[10px] ${idf[t] ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-600 line-through'} ${a.className}`}
                style={a.style}
              >
                {t}
              </span>
            )
          })}
        </div>
      )}
      {matched !== undefined && params?.n_chunks && (
        <p className="text-[11px] text-zinc-400">
          Scored all {fmtInt(params.n_chunks)} chunks · <span className="text-zinc-200">{fmtInt(matched)}</span> share at least one word
        </p>
      )}
      {hits.length > 0 && (
        <div className="space-y-1">
          {hits.map((h, i) => (
            <HitRow
              key={`${h.paragraph}-${h.absatz}`}
              rank={i + 1}
              label={para(h.paragraph, h.absatz)}
              value={h.score.toFixed(2)}
              fraction={h.score / max}
              color={ARM.bm25}
              note={h.terms?.length ? `matched ${h.terms.map((t) => `"${t.term}"`).join(', ')}` : undefined}
              animate={animate}
              delay={300 + i * 140}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface DenseRow {
  paragraph: string
  heading: string
  paragraph_cosine: number
}

export function SemanticThought({ stage, animate }: { stage: TraceStage; animate: boolean }) {
  const rows = ((stage.rows ?? []) as DenseRow[]).slice(0, 5)
  const all = (stage.all_paragraphs ?? []) as Array<{ cosine: number }>
  const min = Math.min(...all.map((p) => p.cosine), ...rows.map((r) => r.paragraph_cosine))
  const max = Math.max(...rows.map((r) => r.paragraph_cosine), min + 1e-6)
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-400">
        Question → {String(stage.dim ?? 768)}-number vector · compared with all {String(stage.n_paragraphs ?? all.length)} paragraphs by cosine
      </p>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <HitRow
            key={r.paragraph}
            rank={i + 1}
            label={para(r.paragraph)}
            value={r.paragraph_cosine.toFixed(3)}
            fraction={(r.paragraph_cosine - min) / (max - min)}
            color={ARM.dense}
            note={r.heading}
            animate={animate}
            delay={150 + i * 140}
          />
        ))}
      </div>
    </div>
  )
}

export function GateThought({ stage, animate }: { stage: TraceStage; animate: boolean }) {
  const value = stage.confidence as number
  const floor = stage.floor as number | null
  const passed = stage.passed as boolean
  if (floor === null) return <p className="text-zinc-400">No floor configured - answering.</p>
  const lo = Math.min(value, floor) - 0.04
  const hi = Math.max(value, floor) + 0.04
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100
  const fill = anim(animate, 'animate-grow-x', 100)
  return (
    <div className="space-y-1.5">
      <div className="relative h-1.5 max-w-sm rounded-full bg-zinc-800">
        <span
          className={`absolute inset-y-0 left-0 block rounded-full ${passed ? 'bg-emerald-500' : 'bg-amber-500'} ${fill.className}`}
          style={{ ...fill.style, width: `${pos(value)}%` }}
        />
        <span className="absolute -top-1 h-3.5 w-px bg-zinc-200" style={{ left: `${pos(floor)}%` }} />
      </div>
      <p className="text-[11px] text-zinc-400">
        best match confidence <span className="font-mono text-zinc-200">{value.toFixed(3)}</span>{' '}
        {passed ? '≥' : '<'} floor <span className="font-mono text-zinc-200">{floor.toFixed(3)}</span> →{' '}
        {passed ? 'in scope, answer it' : 'out of scope, decline without calling the LLM'}
      </p>
    </div>
  )
}

export function PromptThought({ stage, trace, animate }: { stage: TraceStage; trace: PipelineTrace | null; animate: boolean }) {
  const chunks = (stage.retrieved_chunks_sent ?? []) as Array<{ index: number; paragraph: string; absatz: string }>
  const messages = (stage.messages ?? []) as Array<{ content: string }>
  const chars = messages.reduce((a, m) => a + m.content.length, 0)
  const model = (stage.params as { model?: string } | undefined)?.model ?? trace?.meta?.llm_model
  const feedback = ((stage.sections ?? []) as Array<{ kind: string }>).some((s) => s.kind === 'feedback')
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-zinc-400">
        Sending to <span className="font-mono text-zinc-200">{model ?? 'the LLM'}</span>
        {chars > 0 && <> · ≈{fmtInt(Math.round(chars / 4))} tokens</>}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded border border-zinc-700 px-1.5 py-px text-[10px] text-zinc-400">answer rules</span>
        {chunks.map((c, i) => {
          const a = anim(animate, 'animate-pop-in', 100 + i * 110)
          return (
            <span key={c.index} className={`rounded border border-zinc-700 bg-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-100 ${a.className}`} style={a.style}>
              [{c.index}] {para(c.paragraph, c.absatz)}
            </span>
          )
        })}
        {Boolean(stage.gap_annotation_injected) && <span className="rounded border border-zinc-700 px-1.5 py-px text-[10px] text-zinc-400">scope note</span>}
        {feedback && <span className="rounded border border-amber-500/40 px-1.5 py-px text-[10px] text-amber-300">verifier feedback</span>}
        <span className="rounded border border-zinc-700 px-1.5 py-px text-[10px] text-zinc-400">question</span>
      </div>
    </div>
  )
}

interface Check {
  kind: string
  target: string
  passed: boolean
  detail: string
}

export function VerifyThought({ checks, animate }: { checks: Check[]; animate: boolean }) {
  if (checks.length === 0) return <p className="text-[11px] text-zinc-400">No citations or quotes to check.</p>
  return (
    <div className="flex flex-wrap gap-1">
      {checks.map((c, i) => {
        const a = anim(animate, 'animate-pop-in', i * 90)
        const label = c.kind === 'quote' ? `„${c.target.length > 28 ? c.target.slice(0, 28) + '…' : c.target}"` : c.target
        return (
          <span
            key={i}
            title={c.detail}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] ${
              c.passed ? 'border-zinc-700 bg-zinc-800/70 text-zinc-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            } ${a.className}`}
            style={a.style}
          >
            {c.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-rose-400" />}
            {label}
          </span>
        )
      })}
    </div>
  )
}

