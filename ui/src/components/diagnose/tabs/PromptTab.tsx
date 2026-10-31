import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { stepById } from '../data'
import { Callout, Card, Empty, Legend, Pill, Section } from '../ui'
import { fmtInt } from '../../../lib/text'
import { SERIES } from '../../../lib/colors'
import type { TraceStage } from '../../../types'

interface PromptSection {
  kind: string
  label: string
  text: string
}

// Fixed category order -> fixed palette slots.
const CATEGORIES = [
  { id: 'system', label: 'system message (rules)' },
  { id: 'rules', label: 'rules, repeated in user message' },
  { id: 'chunk', label: 'statute chunks' },
  { id: 'gap_note', label: 'scope note' },
  { id: 'feedback', label: 'verifier feedback' },
  { id: 'question', label: 'question + labels' },
] as const
type Category = (typeof CATEGORIES)[number]['id']
const COLOR: Record<Category, string> = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, SERIES[i]])) as Record<Category, string>
const categoryOf = (kind: string): Category =>
  kind === 'scaffold' ? 'question' : (CATEGORIES.find((c) => c.id === kind)?.id ?? 'question')

const approxTokens = (chars: number) => Math.round(chars / 4)

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
    >
      {done ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {done ? 'copied' : 'copy messages JSON'}
    </button>
  )
}

function Composition({ system, sections, promptTokens }: { system: string; sections: PromptSection[]; promptTokens?: number }) {
  const parts: Array<{ cat: Category; chars: number; label: string }> = [
    { cat: 'system', chars: system.length, label: 'system message' },
    ...sections.map((s) => ({ cat: categoryOf(s.kind), chars: s.text.length + 1, label: s.label || 'labels' })),
  ]
  const total = parts.reduce((a, p) => a + p.chars, 0)
  const byCat = CATEGORIES.map((c) => ({ ...c, chars: parts.filter((p) => p.cat === c.id).reduce((a, p) => a + p.chars, 0) })).filter(
    (c) => c.chars > 0,
  )
  return (
    <Card className="space-y-3 p-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
        {parts.map((p, i) => (
          <div
            key={i}
            title={`${p.label}: ≈${fmtInt(approxTokens(p.chars))} tokens`}
            className="h-full border-r-2 border-zinc-950 last:border-r-0"
            style={{ width: `${(p.chars / total) * 100}%`, background: COLOR[p.cat] }}
          />
        ))}
      </div>
      <Legend items={byCat.map((c) => ({ color: COLOR[c.id], label: `${c.label} ≈${fmtInt(approxTokens(c.chars))}` }))} />
      <p className="text-[11px] text-zinc-500">
        Section sizes are estimated at ~4 characters per token.
        {promptTokens ? ` The endpoint reported ${fmtInt(promptTokens)} prompt tokens in total.` : ''}
      </p>
    </Card>
  )
}

function PromptView({ stage, promptTokens }: { stage: TraceStage; promptTokens?: number }) {
  const messages = (stage.messages ?? []) as Array<{ role: string; content: string }>
  const sections = (stage.sections ?? []) as PromptSection[]
  const params = (stage.params ?? {}) as { model?: string; temperature?: number; max_tokens?: number }
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const repeated = Boolean(stage.system_prompt_repeated_in_user_message)

  if (messages.length === 0) {
    // older stored trace: only the flat prompt was recorded
    return (
      <Card className="p-3">
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-300">
          {String(stage.final_prompt ?? '(prompt not kept in browser storage)')}
        </pre>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Section title="Call" hint="The request sent to the OpenAI-compatible chat-completions endpoint.">
        <div className="flex flex-wrap gap-1.5">
          {params.model && <Pill>model {params.model}</Pill>}
          {params.temperature !== undefined && <Pill>temperature {params.temperature}</Pill>}
          {params.max_tokens !== undefined && <Pill>max_tokens {params.max_tokens}</Pill>}
          <Pill>stream true</Pill>
          <Pill>{messages.length} messages</Pill>
        </div>
      </Section>

      <Section title="Context composition" hint="What the model's context window is spent on.">
        <Composition system={system} sections={sections} promptTokens={promptTokens} />
      </Section>

      {repeated && (
        <Callout tone="warn" title="The answer rules are sent twice">
          The same rules go in the system message and again at the top of the user message - about{' '}
          {fmtInt(approxTokens(system.length))} extra tokens on every request. Shown as found; the prompt itself is
          unchanged.
        </Callout>
      )}

      <Section title="Messages, exactly as sent" actions={<CopyButton text={JSON.stringify(messages, null, 2)} />}>
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: COLOR.system }} />
              <span className="font-mono text-[11px] text-zinc-300">system</span>
              <span className="ml-auto font-mono text-[10px] text-zinc-500">≈{fmtInt(approxTokens(system.length))} tokens</span>
            </div>
            <details className="group">
              <summary className="cursor-pointer px-3 py-2 text-[11px] text-zinc-400 hover:text-zinc-200">
                {system.split('\n')[0]} <span className="text-zinc-600 group-open:hidden">· show all</span>
              </summary>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                {system}
              </pre>
            </details>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
              <span className="font-mono text-[11px] text-zinc-300">user</span>
              <span className="ml-auto font-mono text-[10px] text-zinc-500">{sections.length} parts</span>
            </div>
            <div className="space-y-1 p-2">
              {sections.map((s, i) =>
                s.kind === 'scaffold' ? (
                  <p key={i} className="px-2 font-mono text-[10px] text-zinc-500">
                    {s.text.trim()}
                  </p>
                ) : s.kind === 'rules' ? (
                  <details key={i} className="rounded-md border-l-2 bg-zinc-950/60 px-2.5 py-1.5" style={{ borderColor: COLOR.rules }}>
                    <summary className="cursor-pointer text-[11px] text-zinc-400">
                      answer rules (same text as the system message) · ≈{fmtInt(approxTokens(s.text.length))} tokens
                    </summary>
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-400">{s.text}</pre>
                  </details>
                ) : (
                  <div key={i} className="rounded-md border-l-2 bg-zinc-950/60 px-2.5 py-1.5" style={{ borderColor: COLOR[categoryOf(s.kind)] }}>
                    <div className="mb-0.5 flex items-center justify-between font-mono text-[10px] text-zinc-500">
                      <span>{s.label}</span>
                      <span>≈{fmtInt(approxTokens(s.text.length))} tokens</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">{s.text.trim()}</p>
                  </div>
                ),
              )}
            </div>
          </Card>
        </div>
      </Section>
    </div>
  )
}

export function PromptTab({ data }: { data: DiagnoseData }) {
  const prompts = (data.trace?.stages ?? []).filter((s) => s.stage === 'prompt_assembly')
  const generations = (data.trace?.stages ?? []).filter((s) => s.stage.startsWith('generation_attempt_'))
  const [picked, setPicked] = useState<number | null>(null)
  if (prompts.length === 0) {
    const step = stepById(data, 'prompt')
    return <Empty>{step.reason ? `No prompt was built: ${step.reason}.` : 'Waiting for the prompt…'}</Empty>
  }
  const index = Math.min(picked ?? prompts.length - 1, prompts.length - 1)
  const usage = generations[index]?.usage as { prompt_tokens?: number } | undefined
  return (
    <div className="space-y-4">
      {prompts.length > 1 && (
        <AttemptPicker count={prompts.length} value={index} onChange={setPicked} note="The retry adds the verifier's feedback." />
      )}
      <PromptView key={index} stage={prompts[index]} promptTokens={usage?.prompt_tokens} />
    </div>
  )
}

export function AttemptPicker({
  count,
  value,
  onChange,
  note,
}: {
  count: number
  value: number
  onChange: (i: number) => void
  note?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={`rounded-md px-2.5 py-1 text-[11px] ${i === value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Attempt {i + 1}
          </button>
        ))}
      </div>
      {note && <span className="text-[11px] text-zinc-500">{note}</span>}
    </div>
  )
}
