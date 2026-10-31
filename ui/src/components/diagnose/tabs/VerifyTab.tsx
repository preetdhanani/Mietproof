import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { findStage, stepById } from '../data'
import { Callout, Card, Empty, Section } from '../ui'
import { attemptOf } from '../../../lib/pipeline'
import { para } from '../../../lib/text'

interface Check {
  kind: 'ref' | 'paragraph' | 'quote'
  target: string
  passed: boolean
  detail: string
}

const GROUPS: Array<{ kind: Check['kind']; title: string; hint: string }> = [
  { kind: 'ref', title: 'Chunk references', hint: 'Every [n] in the answer must be one of the chunks the model was given.' },
  { kind: 'paragraph', title: 'Cited paragraphs', hint: 'Every cited § must exist in the current index.' },
  {
    kind: 'quote',
    title: 'German quotes',
    hint: 'Every quoted German span (3+ words) must appear verbatim in a cited paragraph - this catches invented law.',
  },
]

export function VerifyTab({ data }: { data: DiagnoseData }) {
  const generations = (data.trace?.stages ?? []).filter((s) => s.stage.startsWith('generation_attempt_'))
  const citations = findStage(data.trace, 'citation_assembly')
  const refusal = findStage(data.trace, 'refusal')
  if (generations.length === 0) {
    const step = stepById(data, 'verify')
    return <Empty>{step.reason ? `Nothing to verify: ${step.reason}.` : 'Waiting for the model output…'}</Empty>
  }

  return (
    <div className="space-y-6">
      {refusal ? (
        <Callout tone="fail" title="Refused">
          Both drafts failed verification, so the user sees the nearest retrieved paragraphs instead of an unverified
          answer.
        </Callout>
      ) : citations ? (
        <Callout tone="pass" title="Verified">
          Every check passed{generations.length > 1 ? ' on the second attempt' : ''}. Citations are built from the chunk
          metadata, not from text the model wrote, so a § number can never be invented.
        </Callout>
      ) : null}

      {generations.map((g) => {
        const checks = (g.verification_checks ?? []) as Check[]
        const failures = (g.verification_failures ?? []) as string[]
        return (
          <Section
            key={g.stage}
            title={`Attempt ${attemptOf(g)} · ${g.verification_passed ? 'passed' : 'rejected'}`}
            hint={checks.length === 0 && failures.length === 0 ? 'No citations or quotes to check in this answer.' : undefined}
          >
            {checks.length === 0 && failures.length > 0 && (
              <ul className="space-y-1 text-xs text-rose-300">
                {failures.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            )}
            {GROUPS.map((group) => {
              const items = checks.filter((c) => c.kind === group.kind)
              if (items.length === 0) return null
              return (
                <Card key={group.kind} className="overflow-hidden">
                  <div className="border-b border-zinc-800 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-100">{group.title}</span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {items.filter((c) => c.passed).length}/{items.length} passed
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">{group.hint}</p>
                  </div>
                  {group.kind !== 'quote' ? (
                    <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                      {items.map((c, i) => (
                        <span
                          key={i}
                          title={c.detail}
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                            c.passed ? 'border-zinc-700 bg-zinc-800/60 text-zinc-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                          }`}
                        >
                          {c.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-rose-400" />}
                          {c.target}
                        </span>
                      ))}
                      {items.some((c) => !c.passed) && (
                        <ul className="w-full space-y-0.5 pt-1 text-[11px] text-rose-300">
                          {items.filter((c) => !c.passed).map((c, i) => (
                            <li key={i}>· {c.detail}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                  <ul className="divide-y divide-zinc-800/60">
                    {items.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 px-3 py-1.5">
                        {c.passed ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                        )}
                        <div className="min-w-0 text-[11px] leading-relaxed">
                          {c.kind === 'quote' ? (
                            <p className="italic text-zinc-200">„{c.target}"</p>
                          ) : (
                            <span className="font-mono text-zinc-200">{c.target}</span>
                          )}
                          <p className="text-zinc-500">{c.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  )}
                </Card>
              )
            })}
          </Section>
        )
      })}

      {citations && (
        <Section title="Citation map" hint="How each [n] in the answer resolves to the official source.">
          <Card className="divide-y divide-zinc-800/60">
            {((citations.citations ?? []) as Array<{ index: number; paragraph: string; absatz: string; deep_link: string; gloss_en?: string }>).map(
              (c) => (
                <a
                  key={`${c.index}-${c.paragraph}`}
                  href={c.deep_link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 px-3 py-2 hover:bg-zinc-800/40"
                >
                  <span className="rounded bg-zinc-700/80 px-1 font-mono text-[10px] text-zinc-100">[{c.index}]</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-zinc-100">{para(c.paragraph, c.absatz)} BGB</span>
                    {c.gloss_en && <span className="block truncate text-[11px] text-zinc-500">{c.gloss_en}</span>}
                  </span>
                  <ExternalLink className="mt-0.5 h-3 w-3 text-zinc-500" />
                </a>
              ),
            )}
          </Card>
        </Section>
      )}
    </div>
  )
}
