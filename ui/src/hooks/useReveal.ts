import { useEffect, useRef, useState } from 'react'
import type { TraceStage } from '../types'

// How long each step stays "current" before the next one is shown (ms). The
// backend's retrieval takes ~60 ms, far too fast to follow; the feed replays
// the real results at a readable pace while the LLM call runs in parallel.
const DWELL: Record<string, number> = {
  query_enrichment: 450,
  bm25_retrieval: 700,
  dense_retrieval: 700,
  hybrid_fusion: 1300,
  out_of_scope_floor: 500,
  prompt_assembly: 500,
  citation_assembly: 700,
}
const DEFAULT_DWELL = 350
const FIRST_STEP_DELAY = 200

function dwell(stage: string | undefined): number {
  if (!stage) return FIRST_STEP_DELAY
  return DWELL[stage] ?? DEFAULT_DWELL
}

// Progress per message, kept outside React so switching chats and back
// resumes the replay instead of restarting it. Never persisted.
const progress = new Map<string, number>()

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * How many of `stages` to show. With `animate`, stages appear one at a time
 * (each waits its predecessor's dwell, measured from when that predecessor
 * appeared); once the result is in, dwells are halved so the answer is not
 * held back long. Without `animate`, everything shows at once.
 */
export function useReveal(id: string, stages: TraceStage[], animate: boolean, resultIn: boolean) {
  const [revealed, setRevealed] = useState(() => progress.get(id) ?? 0)
  const lastAt = useRef(0)
  const enabled = animate && !reducedMotion
  const total = stages.length
  const previous = revealed > 0 ? stages[revealed - 1]?.stage : undefined

  useEffect(() => {
    if (!enabled || revealed >= total) return
    const wait = dwell(previous) * (resultIn ? 0.5 : 1)
    const elapsed = lastAt.current ? performance.now() - lastAt.current : 0
    const timer = setTimeout(
      () => {
        lastAt.current = performance.now()
        setRevealed((r) => {
          progress.set(id, r + 1)
          return r + 1
        })
      },
      Math.max(0, wait - elapsed),
    )
    return () => clearTimeout(timer)
  }, [enabled, revealed, total, previous, resultIn, id])

  const shown = enabled ? Math.min(revealed, total) : total
  const skip = () => {
    progress.set(id, Number.MAX_SAFE_INTEGER)
    setRevealed(Number.MAX_SAFE_INTEGER)
  }
  const skipped = revealed === Number.MAX_SAFE_INTEGER
  return { shown, done: shown >= total, animating: enabled && revealed < total, skipped, skip }
}
