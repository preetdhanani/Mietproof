import type { AskResponse, Draft, PipelineTrace, TraceStage } from '../../types'
import type { StepId, StepState } from '../../lib/pipeline'

/** Everything a diagnose tab can show for one answer. */
export interface DiagnoseData {
  trace: PipelineTrace | null
  steps: StepState[]
  /** LLM text streamed per attempt (live only; finished attempts are in the trace) */
  drafts: Record<number, Draft>
  streaming: number | null
  live: boolean
  response: AskResponse | null
  error: string | null
  /** the panel is expanded to a full-width workbench */
  wide: boolean
  /** open another tab */
  goto: (step: StepId | 'overview') => void
}

export function findStage(trace: PipelineTrace | null, name: string): TraceStage | undefined {
  const stages = trace?.stages ?? []
  for (let i = stages.length - 1; i >= 0; i--) if (stages[i].stage === name) return stages[i]
  return undefined
}

export function stepById(data: DiagnoseData, id: StepId): StepState {
  return data.steps.find((s) => s.def.id === id)!
}
