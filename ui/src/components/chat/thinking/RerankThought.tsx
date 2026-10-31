import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import type { PipelineTrace, TraceStage } from '../../../types'
import { ARM } from '../../../lib/colors'
import { para } from '../../../lib/text'
import { anim } from './anim'

interface Ranked {
  paragraph: string
  absatz: string
  score: number
}
interface FusionRow {
  paragraph: string
  absatz: string
  rrf_score: number
  arms?: { bm25?: { rank: number }; dense?: { rank: number } }
  selected?: boolean
}

const MAX_ROWS = 5

function Column({ title, color, rows, digits, empty, animate, side }: {
  title: string
  color: string
  rows: Ranked[]
  digits: number
  empty: string
  animate: boolean
  side: 'left' | 'right'
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-zinc-500">{empty}</p>
      ) : (
        <ol className="space-y-0.5">
          {rows.map((r, i) => {
            const a = anim(animate, side === 'left' ? 'animate-slide-in-left' : 'animate-slide-in-right', i * 90)
            return (
              <li key={`${r.paragraph}-${r.absatz}`} className={`flex items-center gap-1.5 ${a.className}`} style={a.style}>
                <span className="w-3 text-right font-mono text-[10px] text-zinc-500">{i + 1}</span>
                <span className="truncate font-mono text-[11px] text-zinc-200">{para(r.paragraph, r.absatz)}</span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-zinc-500">{r.score.toFixed(digits)}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/**
 * The fusion step as it happens: both rankings side by side, then the fused
 * order assembled row by row - each row slides in from the search that found
 * it (or pops in when both did). Top rows go to the LLM, the rest are dropped.
 */
export function RerankThought({ stage, trace, animate }: { stage: TraceStage; trace: PipelineTrace | null; animate: boolean }) {
  const bm25 = trace?.stages.find((s) => s.stage === 'bm25_retrieval')
  const dense = trace?.stages.find((s) => s.stage === 'dense_retrieval')
  const bm25Rows = ((bm25?.candidates ?? []) as Ranked[]).filter((r) => r.score > 0).slice(0, MAX_ROWS)
  const denseRows = ((dense?.top10 ?? []) as Ranked[]).slice(0, MAX_ROWS)
  const fused = ((stage.candidates ?? stage.final_ranking ?? []) as FusionRow[]).slice(0, MAX_ROWS + 3)
  const sent = fused.filter((r) => r.selected ?? true).length
  const max = Math.max(...fused.map((r) => r.rrf_score), 1e-6)
  const k = (stage.weights as { rrf_k?: number } | undefined)?.rrf_k ?? 60
  const start = 650 // fused rows start after both columns are in
  const divider = anim(animate, 'animate-fade-in', start - 200)
  const note = anim(animate, 'animate-fade-in', start + fused.length * 130 + 200)

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-4">
        <Column title="Keyword (BM25)" color={ARM.bm25} rows={bm25Rows} digits={2} empty="no keyword matches" animate={animate} side="left" />
        <Column title="Semantic" color={ARM.dense} rows={denseRows} digits={3} empty="no results" animate={animate} side="right" />
      </div>

      <p className={`flex items-center gap-1.5 text-[11px] text-zinc-400 ${divider.className}`} style={divider.style}>
        <span className="h-px flex-1 bg-zinc-800" />
        merged by rank: score = Σ weight / ({k} + rank)
        <span className="h-px flex-1 bg-zinc-800" />
      </p>

      <ol className="space-y-0.5">
        {fused.map((r, i) => {
          const fromBm25 = Boolean(r.arms?.bm25)
          const fromDense = Boolean(r.arms?.dense)
          const cls = fromBm25 && fromDense ? 'animate-pop-in' : fromBm25 ? 'animate-slide-in-left' : 'animate-slide-in-right'
          const delay = start + i * 130
          const row = anim(animate, cls, delay)
          const bar = anim(animate, 'animate-grow-x', delay + 150)
          const selected = r.selected ?? true
          const moved = r.arms?.dense ? r.arms.dense.rank - (i + 1) : null
          return (
            <li key={`${r.paragraph}-${r.absatz}`} className={selected ? '' : 'opacity-40'}>
              <div className={`flex items-center gap-2 ${row.className}`} style={row.style}>
                <span className="w-3 text-right font-mono text-[10px] text-zinc-500">{i + 1}</span>
                <span className="w-[5.5rem] shrink-0 truncate font-mono text-[11px] text-zinc-100">{para(r.paragraph, r.absatz)}</span>
                <span className="hidden w-24 shrink-0 gap-1 font-mono text-[10px] sm:flex">
                  <span className={fromBm25 ? 'text-zinc-300' : 'text-zinc-600'}>BM25 {fromBm25 ? `#${r.arms!.bm25!.rank}` : '-'}</span>
                  <span className={fromDense ? 'text-zinc-300' : 'text-zinc-600'}>sem {fromDense ? `#${r.arms!.dense!.rank}` : '-'}</span>
                </span>
                <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <span className={`block h-full rounded-full ${bar.className}`} style={{ ...bar.style, width: `${(r.rrf_score / max) * 100}%`, background: ARM.fused }} />
                </span>
                <span className="w-11 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-300">{r.rrf_score.toFixed(4)}</span>
                <span className="flex w-14 shrink-0 items-center gap-0.5 text-[10px]">
                  {selected ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-zinc-400">to LLM</span>
                    </>
                  ) : (
                    <span className="text-zinc-500">dropped</span>
                  )}
                  {moved !== null && moved > 0 && <ArrowUp className="h-3 w-3 text-zinc-400" aria-label={`up ${moved}`} />}
                  {moved !== null && moved < 0 && <ArrowDown className="h-3 w-3 text-zinc-500" aria-label={`down ${-moved}`} />}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
      {sent > 0 && !fused.some((r) => r.selected && r.arms?.bm25) && bm25Rows.length > 0 && (
        <p className={`text-[11px] text-zinc-500 ${note.className}`} style={note.style}>
          The keyword hits ranked too low on meaning - none made the top {sent}.
        </p>
      )}
    </div>
  )
}
