import { Search, Zap, GitMerge, Languages } from 'lucide-react'
import type { TraceStage } from '../../types'
import { StageCard } from './StageCard'
import { ScoreBar } from './ScoreBar'

interface Candidate {
  rank: number
  paragraph: string
  absatz: string
  score: number
  text_preview: string
}

function CandidateList({ candidates, color, max }: { candidates: Candidate[]; color: string; max: number }) {
  return (
    <div className="space-y-1.5">
      {candidates.map((c) => (
        <div key={`${c.paragraph}-${c.absatz}-${c.rank}`} className="space-y-0.5">
          <ScoreBar label={c.paragraph} score={c.score} max={max} color={color} detail={`#${c.rank}`} hoverText={c.text_preview} />
          <p className="text-[11px] text-zinc-400 pl-12 truncate">{c.text_preview}</p>
        </div>
      ))}
    </div>
  )
}

export function Bm25Stage({ stage }: { stage: TraceStage }) {
  const candidates = (stage.candidates ?? []) as Candidate[]
  const max = Math.max(...candidates.map((c) => c.score), 1)
  return (
    <StageCard
      title="BM25 lexical retrieval"
      subtitle={stage.backend as string}
      icon={<Search className="h-4 w-4" />}
      accent="bg-amber-500/15 text-amber-400"
      badge={`${candidates.length} candidates`}
    >
      <CandidateList candidates={candidates} color="bg-amber-600" max={max} />
      <p className="mt-2 text-[11px] text-zinc-400 italic">{stage.note as string}</p>
    </StageCard>
  )
}

interface DenseRow {
  paragraph: string
  paragraph_cosine: number
  best_chunk_cosine: number | null
  heading: string
}

export function DenseStage({ stage }: { stage: TraceStage }) {
  const rows = (stage.rows ?? []) as DenseRow[]
  const max = Math.max(...rows.map((r) => r.paragraph_cosine), 1)
  return (
    <StageCard
      title="Dense embedding retrieval"
      subtitle={stage.backend as string}
      icon={<Zap className="h-4 w-4" />}
      accent="bg-sky-500/15 text-sky-400"
      badge={`${rows.length} paragraphs`}
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.paragraph} className="space-y-0.5">
            <ScoreBar
              label={r.paragraph}
              score={r.paragraph_cosine}
              max={max}
              color="bg-sky-600"
              detail={r.best_chunk_cosine !== null ? `chunk ${r.best_chunk_cosine.toFixed(3)}` : undefined}
              hoverText={r.heading}
            />
            <p className="text-[11px] text-zinc-400 pl-12 truncate">{r.heading}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400 italic">
        Paragraph-space cosine ranks; the chunk space picks the displayed Absatz.
      </p>
    </StageCard>
  )
}

export function FusionStage({ stage }: { stage: TraceStage }) {
  const rows = (stage.final_ranking ?? []) as Array<{
    rank: number
    paragraph: string
    absatz: string
    rrf_score: number
    text_preview?: string
  }>
  const weights = (stage.weights ?? {}) as Record<string, number>
  const max = Math.max(...rows.map((r) => r.rrf_score), 0.001)
  return (
    <StageCard
      title="Hybrid fusion (RRF)"
      subtitle={stage.method as string}
      icon={<GitMerge className="h-4 w-4" />}
      accent="bg-violet-500/15 text-violet-400"
      badge={`k=${weights.rrf_k ?? 60}`}
    >
      <div className="mb-2 flex gap-2 text-[11px] font-mono">
        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
          bm25 ×{weights.bm25}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
          dense ×{weights.dense}
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={`${r.paragraph}-${r.absatz}`} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-400">§{r.paragraph}</span>
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${(r.rrf_score / max) * 100}%` }} />
            </div>
            <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-300">{r.rrf_score.toFixed(5)}</span>
          </div>
        ))}
      </div>
    </StageCard>
  )
}

export function EnrichmentStage({ stage }: { stage: TraceStage }) {
  const terms = (stage.terms_added ?? []) as string[]
  const changed = terms.length > 0
  return (
    <StageCard
      title="Query enrichment (EN → DE)"
      subtitle="cross-lingual lexicon"
      icon={<Languages className="h-4 w-4" />}
      accent="bg-teal-500/15 text-teal-400"
      badge={changed ? `${terms.length} terms` : 'no match'}
    >
      <div className="space-y-2 text-xs">
        <div>
          <span className="text-zinc-500">original:</span>
          <span className="ml-2 text-zinc-200">{stage.original as string}</span>
        </div>
        {changed && (
          <>
            <div className="flex flex-wrap gap-1">
              {terms.map((t, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 font-mono text-[10px]">
                  +{t}
                </span>
              ))}
            </div>
            <div>
              <span className="text-zinc-500">enriched:</span>
              <span className="ml-2 text-zinc-300 font-mono text-[11px]">{stage.enriched as string}</span>
            </div>
          </>
        )}
        <p className="text-[11px] text-zinc-400 italic">{stage.note as string}</p>
      </div>
    </StageCard>
  )
}

