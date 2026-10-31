import { BrainCircuit } from 'lucide-react'
import type { TraceStage } from '../../types'
import { StageCard } from './StageCard'
import { Bm25Stage, DenseStage, EnrichmentStage, FusionStage } from './RetrievalStage'
import { CitationsStage, FloorStage, GenerationStage, PromptStage } from './PipelineStages'

function stageTitle(stage: TraceStage): string {
  if (stage.stage.startsWith('generation_attempt_')) return 'generation'
  return stage.stage
}

export function TracePanel({ stages }: { stages: TraceStage[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 pb-1">
        <BrainCircuit className="h-4 w-4 text-emerald-500/80" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Pipeline trace - how this answer was built
        </span>
        <span className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
      </div>
      {stages.map((stage, i) => {
        const key = `${stage.stage}-${i}`
        const animate = (node: React.ReactNode) => (
          <div key={key} className="stage-enter" style={{ '--stage-index': i } as React.CSSProperties}>
            {node}
          </div>
        )
        switch (stageTitle(stage)) {
          case 'query_enrichment':
            return animate(<EnrichmentStage stage={stage} />)
          case 'bm25_retrieval':
            return animate(<Bm25Stage stage={stage} />)
          case 'dense_retrieval':
            return animate(<DenseStage stage={stage} />)
          case 'hybrid_fusion':
            return animate(<FusionStage stage={stage} />)
          case 'out_of_scope_floor':
            return animate(<FloorStage stage={stage} />)
          case 'prompt_assembly':
            return animate(<PromptStage stage={stage} />)
          case 'citation_assembly':
            return animate(<CitationsStage stage={stage} />)
          case 'generation':
            return animate(
              <GenerationStage
                stage={stage}
                attempt={parseInt(stage.stage.replace('generation_attempt_', ''), 10) || 1}
              />,
            )
          case 'german_input_detection':
            return animate(
              <StageCard
                title="German input detected"
                subtitle="fixed template - no LLM call"
                icon={<BrainCircuit className="h-4 w-4" />}
                accent="bg-zinc-800 text-zinc-300"
              >
                <p className="text-[11px] text-zinc-500 italic">{stage.note as string}</p>
              </StageCard>,
            )
          case 'refusal':
            return animate(
              <StageCard
                title="Refusal after failed verification"
                subtitle="nearest retrieved paragraphs shown instead"
                icon={<BrainCircuit className="h-4 w-4" />}
                accent="bg-rose-500/15 text-rose-400"
              >
                <p className="text-[11px] text-zinc-500 italic">{stage.note as string}</p>
              </StageCard>,
            )
          case 'out_of_scope_response':
            return animate(
              <StageCard
                title="Out-of-scope response"
                subtitle="covered-topics list returned"
                icon={<BrainCircuit className="h-4 w-4" />}
                accent="bg-amber-500/15 text-amber-400"
              >
                <p className="text-[11px] text-zinc-400">{(stage.topics as string[]).join(', ')}</p>
              </StageCard>,
            )
          default:
            return null
        }
      })}
    </div>
  )
}
