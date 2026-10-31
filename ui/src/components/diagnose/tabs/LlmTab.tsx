import { useEffect, useRef, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { stepById } from '../data'
import { Callout, Card, Empty, Section, Stat } from '../ui'
import { AttemptPicker } from './PromptTab'
import { attemptOf } from '../../../lib/pipeline'
import { fmtInt, fmtMs } from '../../../lib/text'

/** Answer text with [n] chunk references made visible. */
export function WithRefs({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\d{1,2}\])/).map((part, i) =>
        /^\[\d{1,2}\]$/.test(part) ? (
          <span key={i} className="mx-px rounded bg-zinc-700/80 px-1 font-mono text-[10px] text-zinc-100">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

/** Scrolls to the bottom while text streams in, unless the user scrolled up. */
function StreamBox({ text, streaming, className, children }: { text: string; streaming: boolean; className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && streaming && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight
  }, [text, streaming])
  return (
    <div ref={ref} className={className}>
      {children}
      {streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-zinc-300 align-middle" />}
    </div>
  )
}

export function LlmTab({ data }: { data: DiagnoseData }) {
  const generations = (data.trace?.stages ?? []).filter((s) => s.stage.startsWith('generation_attempt_'))
  const attempts = Math.max(generations.length, ...Object.keys(data.drafts).map(Number), 0)
  const [picked, setPicked] = useState<number | null>(null)
  if (attempts === 0) {
    const step = stepById(data, 'llm')
    return <Empty>{step.reason ? `The LLM was not called: ${step.reason}.` : 'Waiting for the LLM call to start…'}</Empty>
  }
  const index = Math.min(picked ?? attempts - 1, attempts - 1)
  const attempt = index + 1
  const done = generations.find((g) => attemptOf(g) === attempt)
  const draft = data.drafts[attempt]
  const streaming = data.streaming === attempt && !done
  const reasoning = (done?.reasoning as string | undefined) ?? draft?.reasoning ?? ''
  const answer = (done?.answer as string | undefined) ?? draft?.content ?? ''
  const usage = (done?.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number }
  const model = data.trace?.meta?.llm_model

  return (
    <div className="space-y-6">
      {attempts > 1 && (
        <AttemptPicker count={attempts} value={index} onChange={setPicked} note="The first draft failed verification." />
      )}

      <div className={`grid gap-2 ${data.wide ? 'grid-cols-4' : 'grid-cols-2'}`}>
        <Stat label="Model" value={model ?? '-'} sub="OpenAI-compatible endpoint" />
        <Stat label="First token" value={done?.ttft_ms !== undefined ? fmtMs(done.ttft_ms as number) : streaming ? '…' : '-'} sub="time to first token" />
        <Stat label="Generation" value={done ? fmtMs(done.duration_ms) : streaming ? 'streaming' : '-'} sub="until the last token" />
        <Stat
          label={done?.usage_estimated ? 'Tokens (estimated)' : 'Tokens'}
          value={usage.prompt_tokens ? `${fmtInt(usage.prompt_tokens)} → ${fmtInt(usage.completion_tokens)}` : '-'}
          sub={usage.reasoning_tokens ? `incl. ${fmtInt(usage.reasoning_tokens)} reasoning` : 'prompt → completion'}
        />
      </div>

      <Section
        title="Model reasoning"
        hint="The model's own thinking, streamed from the endpoint before it writes the answer. Not shown to the end user."
      >
        {reasoning ? (
          <StreamBox
            text={reasoning}
            streaming={streaming && !answer}
            className="max-h-72 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs italic leading-relaxed text-zinc-400 whitespace-pre-wrap"
          >
            <BrainCircuit className="mr-1.5 inline h-3.5 w-3.5 not-italic text-zinc-500" />
            {reasoning}
          </StreamBox>
        ) : (
          <Empty>{streaming ? 'Waiting for the first token…' : 'This model returned no separate reasoning.'}</Empty>
        )}
      </Section>

      <Section
        title={done ? 'Model output' : 'Draft (streaming)'}
        hint="Raw model output. It reaches the chat only after every citation passes verification."
      >
        {answer ? (
          <Card className="p-3">
            <StreamBox text={answer} streaming={streaming} className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-200">
              <WithRefs text={answer} />
            </StreamBox>
          </Card>
        ) : (
          <Empty>{streaming ? 'The model is still reasoning…' : 'No output.'}</Empty>
        )}
        {done && (
          <Callout tone={done.verification_passed ? 'pass' : 'warn'}>
            {done.verification_passed
              ? 'All verification checks passed - this text became the answer.'
              : 'Verification failed - this draft was discarded and the model was asked again with the failures as feedback.'}{' '}
            <button className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-100" onClick={() => data.goto('verify')}>
              See the checks
            </button>
          </Callout>
        )}
      </Section>
    </div>
  )
}
