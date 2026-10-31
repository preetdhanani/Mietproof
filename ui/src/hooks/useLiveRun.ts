import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveRun, StreamEvent, TraceMeta } from '../types'

function apply(run: LiveRun, event: StreamEvent): LiveRun {
  switch (event.type) {
    case 'start':
      return {
        ...run,
        trace: { request_id: event.request_id, question: run.trace?.question ?? '', meta: event.meta as TraceMeta, stages: [] },
      }
    case 'stage':
      return run.trace ? { ...run, trace: { ...run.trace, stages: [...run.trace.stages, event.stage] } } : run
    case 'llm_start':
      return { ...run, streaming: event.attempt, drafts: { ...run.drafts, [event.attempt]: { reasoning: '', content: '' } } }
    case 'delta': {
      const draft = run.drafts[event.attempt] ?? { reasoning: '', content: '' }
      return {
        ...run,
        drafts: { ...run.drafts, [event.attempt]: { ...draft, [event.kind]: draft[event.kind] + event.text } },
      }
    }
    default:
      return run
  }
}

/**
 * The request in flight. Stream events are buffered and applied once per
 * animation frame, so a fast token stream re-renders at most ~60 times a
 * second. Kept out of the persisted sessions on purpose.
 */
export function useLiveRun() {
  const [run, setRun] = useState<LiveRun | null>(null)
  // Mirror of the latest applied state, so finish() can return it synchronously.
  const latest = useRef<LiveRun | null>(null)
  const pending = useRef<StreamEvent[]>([])
  const frame = useRef<number | null>(null)

  const drain = useCallback(() => {
    const events = pending.current
    pending.current = []
    if (latest.current) latest.current = events.reduce(apply, latest.current)
    return latest.current
  }, [])

  const push = useCallback(
    (event: StreamEvent) => {
      pending.current.push(event)
      if (frame.current === null)
        frame.current = requestAnimationFrame(() => {
          frame.current = null
          setRun(drain())
        })
    },
    [drain],
  )

  const start = useCallback((sessionId: string, messageId: string, question: string) => {
    pending.current = []
    latest.current = { sessionId, messageId, trace: { request_id: '', question, stages: [] }, drafts: {}, streaming: null }
    setRun(latest.current)
  }, [])

  /** End the run: apply anything still buffered and return the final state. */
  const finish = useCallback((): LiveRun | null => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    const final = drain()
    latest.current = null
    setRun(null)
    return final
  }, [drain])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return { run, start, push, finish }
}
