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
        <BrainCircuit className="h-4 w-4 text-zinc-500" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Pipeline trace - how this answer was built
        </span>
      </div>
      {stages.map((stage, i) => {
        const key = `${stage.stage}-${i}`
        switch (stageTitle(stage)) {
          case 'query_enrichment':
            return <EnrichmentStage key={key} stage={stage} />
          case 'bm25_retrieval':
            return <Bm25Stage key={key} stage={stage} />
          case 'dense_retrieval':
            return <DenseStage key={key} stage={stage} />
          case 'hybrid_fusion':
            return <FusionStage key={key} stage={stage} />
          case 'out_of_scope_floor':
            return <FloorStage key={key} stage={stage} />
          case 'prompt_assembly':
            return <PromptStage key={key} stage={stage} />
          case 'citation_assembly':
            return <CitationsStage key={key} stage={stage} />
          case 'generation':
            return (
              <GenerationStage
                key={key}
                stage={stage}
                attempt={parseInt(stage.stage.replace('generation_attempt_', ''), 10) || 1}
              />
            )
          case 'german_input_detection':
            return (
              <StageCard
                key={key}
                title="German input detected"
                subtitle="fixed template - no LLM call"
                icon={<BrainCircuit className="h-4 w-4" />}
                accent="bg-zinc-800 text-zinc-300"
              >
                <p className="text-[11px] text-zinc-500 italic">{stage.note as string}</p>
              </StageCard>
            )
          case 'refusal':
            return (
              <StageCard
                key={key}
                title="Refusal after failed verification"
                subtitle="nearest retrieved paragraphs shown instead"
                icon={<BrainCircuit className="h-4 w-4" />}
                accent="bg-rose-500/15 text-rose-400"
              >
                <p className="text-[11px] text-zinc-500 italic">{stage.note as string}</p>
              </StageCard>
            )
          case 'out_of_scope_response':
            return (
              <StageCard
                key={key}
                title="Out-of-scope response"
                subtitle="covered-topics list returned"
                icon={<BrainCircuit className="h-4 w-4" />}
                accent="bg-amber-500/15 text-amber-400"
              >
                <p className="text-[11px] text-zinc-400">{(stage.topics as string[]).join(', ')}</p>
              </StageCard>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
