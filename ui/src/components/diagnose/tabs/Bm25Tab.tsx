import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { findStage, stepById } from '../data'
import { Callout, Card, Empty, Legend, Mono, Pill, Section, Stat } from '../ui'
import { useTip } from '../useTip'
import { markTerms, para } from '../../../lib/text'
import { NEUTRAL, OTHER, SERIES } from '../../../lib/colors'

const TERM_COLORS = SERIES.slice(1)

interface TermScore {
  term: string
  tf: number
  contribution: number
}
interface Candidate {
  rank: number
  paragraph: string
  absatz: string
  score: number
  text?: string
  text_preview?: string
  doc_len?: number
  terms?: TermScore[]
}
interface Params {
  k1: number
  b: number
  avgdl: number
  n_chunks: number
}

/** Distribution of every chunk's BM25 score (non-zero ones binned). */
function Histogram({ scores }: { scores: number[] }) {
  const tip = useTip()
  const nonzero = scores.filter((s) => s > 0)
  if (nonzero.length === 0) return null
  const max = Math.max(...nonzero)
  const binCount = Math.min(16, Math.max(4, Math.ceil(Math.sqrt(nonzero.length))))
  const width = max / binCount
  const bins = Array.from({ length: binCount }, (_, i) => ({ from: i * width, to: (i + 1) * width, n: 0 }))
  for (const s of nonzero) bins[Math.min(binCount - 1, Math.floor(s / width))].n++
  const peak = Math.max(...bins.map((b) => b.n))
  return (
    <Card className="p-3">
      <div data-tip-root className="relative">
        <svg viewBox={`0 0 ${binCount * 20} 64`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Histogram of non-zero BM25 scores">
          {bins.map((b, i) => {
            const h = b.n ? Math.max(2, (b.n / peak) * 60) : 0
            return (
              <g key={i}>
                <rect
                  x={i * 20 + 1}
                  y={0}
                  width={18}
                  height={64}
                  fill="transparent"
                  onMouseMove={(e) => tip.show(e, `${b.n} chunk${b.n === 1 ? '' : 's'} scored ${b.from.toFixed(1)}-${b.to.toFixed(1)}`)}
                  onMouseLeave={tip.hide}
                />
                {h > 0 && <rect x={i * 20 + 1} y={64 - h} width={18} height={h} rx={2} fill={NEUTRAL} pointerEvents="none" />}
              </g>
            )
          })}
        </svg>
        {tip.node}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-600">
        <span>0</span>
        <span>score →</span>
        <span>{max.toFixed(1)}</span>
      </div>
    </Card>
  )
}

function CandidateRow({ c, max, colorOf }: { c: Candidate; max: number; colorOf: (t: string) => string }) {
  const [open, setOpen] = useState(false)
  const terms = c.terms ?? []
  const text = c.text ?? c.text_preview ?? ''
  const marked = markTerms(text, new Set(terms.map((t) => t.term)))
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full px-3 py-2 text-left">
        <div className="flex items-center gap-2">
          <span className="w-5 font-mono text-[10px] text-zinc-500">#{c.rank}</span>
          <span className="w-24 shrink-0 font-mono text-[11px] text-zinc-200">{para(c.paragraph, c.absatz)}</span>
          <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-zinc-800" style={{ maxWidth: '100%' }}>
            <span className="flex h-full" style={{ width: `${(c.score / max) * 100}%` }}>
              {terms.length > 0 ? (
                terms.map((t) => (
                  <span
                    key={t.term}
                    title={`${t.term}: +${t.contribution.toFixed(2)}`}
                    className="h-full border-r-2 border-zinc-950 last:border-r-0"
                    style={{ width: `${(t.contribution / c.score) * 100}%`, background: colorOf(t.term) }}
                  />
                ))
              ) : (
                <span className="h-full w-full" style={{ background: NEUTRAL }} />
              )}
            </span>
          </span>
          <span className="w-12 text-right font-mono text-[11px] tabular-nums text-zinc-200">{c.score.toFixed(2)}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
        {terms.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
            {terms.map((t) => (
              <span key={t.term} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-px font-mono text-[10px] text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-[2px]" style={{ background: colorOf(t.term) }} />"{t.term}" ×{t.tf} +{t.contribution.toFixed(2)}
              </span>
            ))}
          </div>
        )}
        <p className={`mt-1.5 pl-7 text-[11px] leading-relaxed text-zinc-400 ${open ? '' : 'line-clamp-2'}`}>
          {marked.map((part, i) =>
            part.term ? (
              <mark key={i} className="rounded-sm px-0.5 text-zinc-100" style={{ background: `${colorOf(part.term)}40` }}>
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </button>
      {open && terms.length > 0 && (
        <div className="border-t border-zinc-800 px-3 py-2 pl-10">
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left font-normal">term</th>
                <th className="text-right font-normal">tf (times in chunk)</th>
                <th className="text-right font-normal">contribution</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-300">
              {terms.map((t) => (
                <tr key={t.term} className="border-t border-zinc-800/60">
                  <td className="py-1">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: colorOf(t.term) }} />
                    {t.term}
                  </td>
                  <td className="text-right">{t.tf}</td>
                  <td className="text-right">+{t.contribution.toFixed(3)}</td>
                </tr>
              ))}
              <tr className="border-t border-zinc-700 text-zinc-100">
                <td className="py-1">score (chunk length {c.doc_len ?? '?'} words)</td>
                <td />
                <td className="text-right">{c.score.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </li>
  )
}

export function Bm25Tab({ data }: { data: DiagnoseData }) {
  const stage = findStage(data.trace, 'bm25_retrieval')
  if (!stage) {
    const step = stepById(data, 'bm25')
    return <Empty>{step.reason ? `BM25 did not run: ${step.reason}.` : 'Waiting for the keyword search…'}</Empty>
  }
  const candidates = (stage.candidates ?? []) as Candidate[]
  const params = stage.params as Params | undefined
  const scores = (stage.all_scores ?? []) as number[]
  const matched = stage.matched_chunks as number | undefined
  const idf = (stage.idf ?? {}) as Record<string, number>
  const scored = candidates.filter((c) => c.score > 0)

  // Fixed color per query term in query order; terms past the palette fold to "other".
  // Slot 1 (blue) is skipped: it marks the semantic search everywhere else.
  const termOrder = Object.keys(idf).filter((t) => idf[t] > 0 && scored.some((c) => c.terms?.some((x) => x.term === t)))
  const colorOf = (t: string) => {
    const i = termOrder.indexOf(t)
    return i >= 0 && i < TERM_COLORS.length ? TERM_COLORS[i] : OTHER
  }
  const max = Math.max(...scored.map((c) => c.score), 0.001)

  return (
    <div className="space-y-6">
      <Section
        title="How BM25 scores a chunk"
        hint="For every word of the question: rarer words (high IDF) count more, repeats count with diminishing returns, long chunks are penalised."
      >
        <Mono>
          score(q, d) = Σ<sub>t∈q</sub> IDF(t) · tf·(k1+1) / (tf + k1·(1 − b + b·|d|/avgdl))
        </Mono>
        {params && (
          <div className="flex flex-wrap gap-1.5">
            <Pill>k1 = {params.k1}</Pill>
            <Pill>b = {params.b}</Pill>
            <Pill>avgdl = {params.avgdl} words</Pill>
            <Pill>N = {params.n_chunks} chunks</Pill>
            <Pill>query: "{String(stage.query ?? data.trace?.question ?? '')}"</Pill>
          </div>
        )}
      </Section>

      <div className={`grid gap-2 ${data.wide ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Stat label="Chunks scored" value={params?.n_chunks ?? scores.length} sub="the whole index" />
        <Stat label="Share ≥ 1 word" value={matched ?? scored.length} sub={params ? `${(((matched ?? 0) / params.n_chunks) * 100).toFixed(0)}% of the index` : undefined} />
        {data.wide && <Stat label="Best score" value={scored[0]?.score.toFixed(2) ?? '0'} sub={scored[0] ? para(scored[0].paragraph, scored[0].absatz) : 'no match'} />}
      </div>

      {matched === 0 ? (
        <Callout tone="warn" title="BM25 found nothing for this question">
          The question is English and the statute is German, so they share no words. BM25 adds nothing here; the
          semantic search (which works across languages) carries this answer. This is why the system fuses both instead
          of relying on keywords - see the Fusion tab.
        </Callout>
      ) : (
        <>
          {termOrder.length > 0 && termOrder.every((t) => t.length <= 2) && (
            <Callout tone="warn" title="These matches are accidental">
              Only {termOrder.map((t) => `"${t}"`).join(', ')} matched. Short English words collide with German text -
              the pronoun "I" matches the Roman numeral in citations such as "BGBl. I". BM25 counts shared letters, not
              meaning, so these chunks are probably irrelevant; the semantic search and fusion keep them out of the
              answer.
            </Callout>
          )}
          {scored.length >= 8 && (
          <Section title="Score distribution" hint={`Non-zero scores across the index; ${params ? params.n_chunks - (matched ?? 0) : '?'} chunks scored 0 and are not drawn.`}>
            <Histogram scores={scores} />
          </Section>
          )}
          <Section
            title={`Top ${scored.length} chunks`}
            hint="Each bar is split by how much each query word added. Highlighted words in the text are the matches. Click a row for the numbers."
          >
            {termOrder.length > 1 && (
              <Legend
                items={[
                  ...termOrder.slice(0, TERM_COLORS.length).map((t) => ({ color: colorOf(t), label: `${t} (idf ${idf[t]})` })),
                  ...(termOrder.length > TERM_COLORS.length ? [{ color: OTHER, label: 'other terms' }] : []),
                ]}
              />
            )}
            <ol className="space-y-1.5">
              {scored.map((c) => (
                <CandidateRow key={`${c.paragraph}-${c.absatz}-${c.rank}`} c={c} max={max} colorOf={colorOf} />
              ))}
            </ol>
          </Section>
        </>
      )}
    </div>
  )
}
