import { Loader2 } from 'lucide-react'
import type { DiagnoseData } from '../data'
import { findStage } from '../data'
import { Callout, Card, Empty, Mono, Pill, Section } from '../ui'
import { fmtInt } from '../../../lib/text'

export function QueryTab({ data }: { data: DiagnoseData }) {
  const german = findStage(data.trace, 'german_input_detection')
  const rewrite = findStage(data.trace, 'follow_up_rewrite')
  const rewritten = findStage(data.trace, 'follow_up_rewrite_result')
  const enrichment = findStage(data.trace, 'query_enrichment')
  const bm25 = findStage(data.trace, 'bm25_retrieval')
  const dense = findStage(data.trace, 'dense_retrieval')
  const question = data.trace?.question ?? ''

  if (german) {
    return (
      <div className="space-y-4">
        <Section title="Question">
          <Mono>{question}</Mono>
        </Section>
        <Callout tone="warn" title="German input detected">
          Umlauts plus German stop words fired the language heuristic. The assistant answers in English only, so it
          returns a fixed reply pointing to the official German text - no search, no LLM call, no tokens spent.
        </Callout>
      </div>
    )
  }
  if (!enrichment && !rewrite) return <Empty>Waiting for the backend to read the question…</Empty>

  const added = [...new Set((enrichment?.terms_added ?? []) as string[])]
  const idf = (bm25?.idf ?? {}) as Record<string, number>
  const tokens = (bm25?.query_tokens ?? []) as string[]
  const counts = tokens.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {})
  const embedded = (dense?.embedded_text as string | undefined) ?? String(enrichment?.enriched ?? '')

  return (
    <div className="space-y-6">
      <Section title="Question as typed">
        <Mono>{question}</Mono>
      </Section>

      {rewrite && (
        <Section
          title="Follow-up rewrite"
          hint="Short or referring questions are rewritten with the chat history, so search gets a standalone question."
        >
          <Card className="space-y-2 p-3">
            {((rewrite.history_used ?? []) as Array<{ role: string; content: string }>).map((m, i) => (
              <p key={i} className="line-clamp-2 text-xs text-zinc-400">
                <span className="font-mono text-zinc-500">{m.role}</span> {m.content}
              </p>
            ))}
            {!rewritten && (
              <p className="flex items-center gap-1.5 border-t border-zinc-800 pt-2 text-xs text-zinc-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> The LLM is rewriting the question…
              </p>
            )}
            {rewritten && (
              <div className="border-t border-zinc-800 pt-2">
                <p className="text-[11px] text-zinc-500">
                  Rewritten by the LLM
                  {(rewritten.usage as { total_tokens?: number } | undefined)?.total_tokens
                    ? ` · ${fmtInt((rewritten.usage as { total_tokens: number }).total_tokens)} tokens`
                    : ''}
                </p>
                <p className="text-sm text-zinc-100">{String(rewritten.rewritten)}</p>
              </div>
            )}
          </Card>
        </Section>
      )}

      {enrichment && (
      <Section
        title="What each search receives"
        hint="The two searches do not see the same text. That difference explains most of what happens next."
      >
        <div className={`grid gap-3 ${data.wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Card className="space-y-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-zinc-100">BM25 · keyword search</span>
              <Pill>{tokens.length} tokens</Pill>
            </div>
            <p className="text-xs text-zinc-400">
              The question exactly as typed, split into lowercase words. The German enrichment is <em>not</em> added
              here.
            </p>
            {tokens.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {Object.entries(counts).map(([t, n]) => (
                  <span
                    key={t}
                    title={idf[t] ? `idf ${idf[t]} - rarer words weigh more` : 'not in the statute - adds nothing'}
                    className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                      idf[t] ? 'border-zinc-600 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-500 line-through decoration-zinc-600'
                    }`}
                  >
                    {t}
                    {n > 1 && <span className="ml-1 text-zinc-500">×{n}</span>}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">BM25 is not part of the configured backend.</p>
            )}
            {tokens.length > 0 && (
              <p className="text-[11px] text-zinc-500">Struck-through words never appear in the statute, so they score 0.</p>
            )}
          </Card>

          <Card className="space-y-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-zinc-100">Semantic · embedding model</span>
              {added.length > 0 && <Pill>+{added.length} German terms</Pill>}
            </div>
            <p className="text-xs text-zinc-400">
              The question plus German legal terms from a hand-built lexicon, with the model's required{' '}
              <code className="text-zinc-300">query:</code> prefix. This exact string is turned into a vector.
            </p>
            <Mono>
              {added.length > 0 ? <EnrichedText text={embedded} added={added} /> : embedded}
            </Mono>
            {added.length === 0 && <p className="text-[11px] text-zinc-500">No lexicon term matched this question.</p>}
          </Card>
        </div>
      </Section>
      )}
    </div>
  )
}

function EnrichedText({ text, added }: { text: string; added: string[] }) {
  const set = new Set(added)
  return (
    <>
      {text.split(/(\s+)/).map((word, i) =>
        set.has(word) ? (
          <mark key={i} className="rounded bg-emerald-500/15 px-0.5 text-emerald-200">
            {word}
          </mark>
        ) : (
          <span key={i}>{word}</span>
        ),
      )}
    </>
  )
}
