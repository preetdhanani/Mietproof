import { ArrowDown, ArrowUp } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { findStage, stepById } from '../data'
import { Callout, Card, Empty, Legend, Mono, Pill, Section, Swatch } from '../ui'
import { para } from '../../../lib/text'
import { ARM } from '../../../lib/colors'

interface Arm {
  rank: number
  contribution: number
}
interface FusionRow {
  rank: number
  paragraph: string
  absatz: string
  rrf_score: number
  arms?: { bm25?: Arm; dense?: Arm }
  selected?: boolean
}

function ArmCell({ arm, color }: { arm?: Arm; color: string }) {
  if (!arm) return <span className="font-mono text-[11px] text-zinc-600">-</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Swatch color={color} />
      <span className="font-mono text-[11px] text-zinc-200">#{arm.rank}</span>
      <span className="font-mono text-[10px] text-zinc-500">+{arm.contribution.toFixed(4)}</span>
    </span>
  )
}

export function FusionTab({ data }: { data: DiagnoseData }) {
  const stage = findStage(data.trace, 'hybrid_fusion')
  if (!stage) {
    const step = stepById(data, 'fusion')
    return <Empty>{step.reason ? `Fusion did not run: ${step.reason}.` : 'Waiting for fusion…'}</Empty>
  }
  const weights = (stage.weights ?? {}) as { bm25?: number; dense?: number; rrf_k?: number }
  const k = weights.rrf_k ?? 60
  const rows = ((stage.candidates ?? stage.final_ranking ?? []) as FusionRow[]).map((r, i) => ({
    ...r,
    rank: r.rank ?? i + 1,
    selected: r.selected ?? true,
  }))
  const sentCount = rows.filter((r) => r.selected).length
  const shown = rows.slice(0, Math.max(sentCount + 6, 10))
  const max = Math.max(...rows.map((r) => r.rrf_score), 0.0001)

  // Arms rank per (paragraph, Absatz): the same § with different Absätze does not add up.
  const bm25 = findStage(data.trace, 'bm25_retrieval')
  const dense = findStage(data.trace, 'dense_retrieval')
  const armAbsatz = (stageRows: unknown) =>
    new Map(((stageRows ?? []) as Array<{ paragraph: string; absatz: string }>).map((r) => [r.paragraph, r.absatz]))
  const bm25Abs = armAbsatz(bm25?.candidates)
  const denseAbs = armAbsatz(dense?.top10)
  const splits = rows
    .filter((r) => r.selected)
    .flatMap((r) => {
      const other = !r.arms?.bm25 ? bm25Abs.get(r.paragraph) : !r.arms?.dense ? denseAbs.get(r.paragraph) : undefined
      return other && other !== r.absatz ? [`${para(r.paragraph, r.absatz)} (the other search picked Abs. ${other})`] : []
    })
  const bm25Contributed = rows.some((r) => r.selected && r.arms?.bm25)

  return (
    <div className="space-y-6">
      <Section
        title="How fusion re-ranks"
        hint="Reciprocal rank fusion only looks at positions, not raw scores - so BM25 scores (0-20) and cosines (0-1) can be combined fairly. A chunk ranked well by both searches beats one ranked first by only one."
      >
        <Mono>
          RRF(d) = Σ<sub>search</sub> weight / (k + rank(d)) &nbsp;·&nbsp; k = {k}
        </Mono>
        <div className="flex flex-wrap gap-1.5">
          <Pill>
            <Swatch color={ARM.bm25} /> BM25 weight {weights.bm25 ?? 1}
          </Pill>
          <Pill>
            <Swatch color={ARM.dense} /> semantic weight {weights.dense ?? 2}
          </Pill>
          <Pill>top {sentCount} go to the LLM</Pill>
        </div>
        <p className="text-[11px] text-zinc-500">
          Semantic gets twice the weight: on the evaluation set, BM25 alone found the right paragraph far less often
          for English questions.
        </p>
      </Section>

      {!bm25Contributed && (
        <Callout tone="info" title="Semantic search decided this ranking">
          None of the chunks sent to the LLM came from the keyword search, so the fused order equals the semantic order.
        </Callout>
      )}

      <Section title="Fused ranking" hint="Every candidate either search returned. Rows below the line were dropped.">
        <Legend
          items={[
            { color: ARM.bm25, label: 'BM25 rank (contribution)' },
            { color: ARM.dense, label: 'semantic rank (contribution)' },
            { color: ARM.fused, label: 'fused RRF score' },
          ]}
        />
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pl-3 font-medium">#</th>
                <th className="font-medium">chunk</th>
                <th className="font-medium">BM25</th>
                <th className="font-medium">semantic</th>
                <th className="pr-3 font-medium">RRF score</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const parts = [r.arms?.bm25, r.arms?.dense].filter(Boolean) as Arm[]
                const math = parts.map((a) => a.contribution.toFixed(4)).join(' + ')
                const moved = r.arms?.dense ? r.arms.dense.rank - r.rank : null
                return (
                  <tr
                    key={`${r.paragraph}-${r.absatz}`}
                    className={`border-b border-zinc-800/60 ${r.selected ? '' : 'opacity-45'} ${
                      i === sentCount - 1 ? 'border-b-2 border-b-zinc-500' : ''
                    }`}
                  >
                    <td className="py-2 pl-3 align-top font-mono text-[11px] text-zinc-400">{r.rank}</td>
                    <td className="py-2 align-top">
                      <div className="font-mono text-[11px] text-zinc-100">{para(r.paragraph, r.absatz)}</div>
                      {r.selected && <div className="text-[10px] text-emerald-400/90">sent to LLM</div>}
                    </td>
                    <td className="py-2 align-top">
                      <ArmCell arm={r.arms?.bm25} color={ARM.bm25} />
                    </td>
                    <td className="py-2 align-top">
                      <ArmCell arm={r.arms?.dense} color={ARM.dense} />
                      {moved !== null && moved !== 0 && (
                        <span className="ml-1 inline-flex items-center font-mono text-[10px] text-zinc-400">
                          {moved > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {Math.abs(moved)}
                        </span>
                      )}
                    </td>
                    <td className="w-40 py-2 pr-3 align-top">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full" style={{ width: `${(r.rrf_score / max) * 100}%`, background: ARM.fused }} />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-zinc-100">{r.rrf_score.toFixed(4)}</span>
                      </div>
                      {parts.length > 1 && <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{math}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
        {rows.length > shown.length && (
          <p className="text-[11px] text-zinc-500">{rows.length - shown.length} more low-ranked candidates not shown.</p>
        )}
      </Section>

      {splits.length > 0 && (
        <Callout tone="info" title="Same paragraph, different Absatz">
          Rankings are fused per chunk (paragraph + Absatz), so two searches that pick different Absätze of the same §
          do not reinforce each other: {splits.join('; ')}.
        </Callout>
      )}
    </div>
  )
}
