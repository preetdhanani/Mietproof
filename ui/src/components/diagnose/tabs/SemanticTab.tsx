import type { DiagnoseData } from '../data'
import { findStage, stepById } from '../data'
import { Bar, Callout, Card, Empty, Legend, Mono, Pill, Section } from '../ui'
import { useTip } from '../useTip'
import { para } from '../../../lib/text'
import { ARM, NEUTRAL } from '../../../lib/colors'

interface ParagraphCos {
  paragraph: string
  heading: string
  cosine: number
}
interface Row {
  paragraph: string
  heading: string
  paragraph_cosine: number
  best_chunk_cosine: number | null
}

/** Radial similarity map: the query in the centre, each paragraph at a
 * distance of 1 − cosine. The angle only spreads the points (by § order). */
function SimilarityMap({ all, top }: { all: ParagraphCos[]; top: Row[] }) {
  const tip = useTip()
  const size = 300
  const c = size / 2
  const R = c - 18
  const cosines = all.map((p) => p.cosine)
  const maxCos = Math.max(...cosines)
  const minCos = Math.min(...cosines)
  // Radius grows with 1 - cosine over the observed range. A square-root scale
  // spreads the close matches apart; the rings keep the real cosine values.
  const inner = 16
  const radius = (cos: number) => inner + Math.sqrt((maxCos - cos) / Math.max(1e-6, maxCos - minCos)) * (R - inner)
  const rank = new Map(top.map((r, i) => [r.paragraph, i + 1]))
  // Rings evenly spaced on screen, each labelled with the cosine it marks.
  const rings = [0.35, 0.7, 1].map((f) => maxCos - f * f * (maxCos - minCos))

  return (
    <Card className="p-3">
      <div data-tip-root className="relative mx-auto" style={{ maxWidth: 360 }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full" role="img" aria-label="Similarity map of all paragraphs around the query">
          {rings.map((v) => (
            <g key={v}>
              <circle cx={c} cy={c} r={radius(v)} fill="none" stroke="#27272a" strokeDasharray="2 3" />
              <text x={c + 3} y={c - radius(v) - 3} fontSize="8" fill="#71717a" fontFamily="JetBrains Mono, monospace">
                cos {v.toFixed(3)}
              </text>
            </g>
          ))}
          {all.map((p, i) => {
            const a = (i / all.length) * Math.PI * 2 - Math.PI / 2
            const r = radius(p.cosine)
            const x = c + r * Math.cos(a)
            const y = c + r * Math.sin(a)
            const k = rank.get(p.paragraph)
            const hot = k !== undefined
            return (
              <g key={p.paragraph}>
                {hot && k! <= 5 && (
                  <line x1={c} y1={c} x2={x} y2={y} stroke={ARM.dense} strokeOpacity="0.35" strokeWidth="1" />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={hot ? 4.5 : 2.5}
                  fill={hot ? ARM.dense : NEUTRAL}
                  fillOpacity={hot ? 1 : 0.45}
                  stroke="#09090b"
                  strokeWidth={hot ? 2 : 0}
                  onMouseMove={(e) =>
                    tip.show(
                      e,
                      <>
                        <div className="font-medium text-zinc-100">
                          {para(p.paragraph)} {k ? `· rank ${k}` : ''}
                        </div>
                        <div className="text-zinc-400">{p.heading}</div>
                        <div className="font-mono">cosine {p.cosine.toFixed(4)}</div>
                      </>,
                    )
                  }
                  onMouseLeave={tip.hide}
                />
                {hot && k! <= 5 && (
                  <text
                    x={x + (x >= c ? 6 : -6)}
                    y={y - 4}
                    textAnchor={x >= c ? 'start' : 'end'}
                    fontSize="8"
                    fill="#e4e4e7"
                    fontFamily="JetBrains Mono, monospace"
                    pointerEvents="none"
                  >
                    {k}
                  </text>
                )}
              </g>
            )
          })}
          <circle cx={c} cy={c} r={6} fill="#fafafa" stroke="#09090b" strokeWidth="2" />
          <text x={c} y={c + 18} textAnchor="middle" fontSize="9" fill="#a1a1aa">
            your question
          </text>
        </svg>
        {tip.node}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            { color: ARM.dense, label: 'top 10 by cosine', shape: 'dot' },
            { color: NEUTRAL, label: 'other paragraphs', shape: 'dot' },
          ]}
        />
        <span className="text-[10px] text-zinc-500">closer = more similar · angle only spreads the dots</span>
      </div>
      <ol className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {top.slice(0, 5).map((r, i) => (
          <li key={r.paragraph} className="flex items-baseline gap-1.5 text-[11px]">
            <span className="font-mono text-zinc-500">{i + 1}</span>
            <span className="font-mono text-zinc-200">{para(r.paragraph)}</span>
            <span className="truncate text-zinc-500">{r.heading}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function ScopeGate({ data }: { data: DiagnoseData }) {
  const floor = findStage(data.trace, 'out_of_scope_floor')
  if (!floor) return null
  const value = floor.confidence as number
  const threshold = floor.floor as number | null
  const parts = (floor.components ?? {}) as { chunk_top1?: number; paragraph_top1?: number }
  const passed = floor.passed as boolean
  const lo = Math.min(value, threshold ?? value) - 0.05
  const hi = Math.max(value, threshold ?? value) + 0.05
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  return (
    <Section
      title="Scope gate"
      hint="If even the best match is weak, the question is probably not about rental law - the system declines instead of letting the LLM guess."
    >
      <Card className="space-y-3 p-3">
        <Mono>
          confidence = (max(best chunk cosine, best paragraph cosine) + 1) / 2
          {parts.chunk_top1 !== undefined && parts.paragraph_top1 !== undefined && (
            <>
              <br />= (max({parts.chunk_top1.toFixed(4)}, {parts.paragraph_top1.toFixed(4)}) + 1) / 2 = {value.toFixed(4)}
            </>
          )}
        </Mono>
        {threshold !== null && (
          <div className="px-1 pt-5 pb-1">
            <div className="relative h-1.5 rounded-full bg-zinc-800">
              <div className="absolute inset-y-0 right-0 rounded-r-full bg-emerald-500/20" style={{ left: pos(threshold) }} />
              <div className="absolute -top-1.5 h-4.5 w-px bg-zinc-300" style={{ left: pos(threshold) }}>
                <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-zinc-400">
                  floor {threshold.toFixed(3)}
                </span>
              </div>
              <div
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950 ${passed ? 'bg-emerald-400' : 'bg-amber-400'}`}
                style={{ left: pos(value) }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-600">
              <span>{lo.toFixed(2)}</span>
              <span>answer zone →</span>
              <span>{hi.toFixed(2)}</span>
            </div>
          </div>
        )}
        <Callout tone={passed ? 'pass' : 'warn'}>
          {passed
            ? `Confidence ${value.toFixed(3)} clears the floor - the pipeline goes on to build the prompt.`
            : `Confidence ${value.toFixed(3)} is below the floor - the reply lists the covered topics instead; the LLM is never called.`}{' '}
          The floor was calibrated on a labelled set of in-scope and out-of-scope questions.
        </Callout>
      </Card>
    </Section>
  )
}

export function SemanticTab({ data }: { data: DiagnoseData }) {
  const stage = findStage(data.trace, 'dense_retrieval')
  if (!stage) {
    const step = stepById(data, 'semantic')
    return <Empty>{step.reason ? `Semantic search did not run: ${step.reason}.` : 'Waiting for the semantic search…'}</Empty>
  }
  const rows = (stage.rows ?? []) as Row[]
  const all = (stage.all_paragraphs ?? []) as ParagraphCos[]
  const dim = stage.dim as number | undefined
  const max = Math.max(...rows.map((r) => r.paragraph_cosine), 0.001)
  const min = Math.min(...all.map((p) => p.cosine), ...rows.map((r) => r.paragraph_cosine))

  return (
    <div className="space-y-6">
      <Section
        title="How semantic search works"
        hint="Text with similar meaning lands close together in vector space - across languages - so an English question can find German law."
      >
        <ol className="space-y-1.5 text-xs leading-relaxed text-zinc-300">
          <li>
            <span className="mr-1.5 font-mono text-zinc-500">1</span>The embedding model turns the question into{' '}
            {dim ? `${dim} numbers` : 'a vector'}:
          </li>
          {typeof stage.embedded_text === 'string' && <Mono>{stage.embedded_text}</Mono>}
          <li>
            <span className="mr-1.5 font-mono text-zinc-500">2</span>Each of the {String(stage.n_paragraphs ?? all.length)}{' '}
            statute paragraphs was embedded the same way when the index was built.
          </li>
          <li>
            <span className="mr-1.5 font-mono text-zinc-500">3</span>Similarity is the cosine of the angle between the
            vectors. All vectors have length 1, so it is just the dot product:
          </li>
        </ol>
        <Mono>cos(q, p) = q · p = Σ qᵢ·pᵢ over {dim ?? 768} dimensions → 1.0 identical, 0 unrelated</Mono>
        <div className="flex flex-wrap gap-1.5">
          <Pill>{String(stage.backend ?? 'dense')}</Pill>
          {data.trace?.meta?.embedding_model && <Pill>{data.trace.meta.embedding_model}</Pill>}
        </div>
      </Section>

      {all.length > 0 && (
        <Section title="Similarity map" hint="Every paragraph in the index, placed by how similar it is to your question. Hover a dot.">
          <SimilarityMap all={all} top={rows} />
        </Section>
      )}

      <Section
        title={`Top ${rows.length} paragraphs`}
        hint="Ranked by paragraph cosine. Inside each paragraph, the best-matching Absatz (chunk) is what gets passed on."
      >
        <Card className="divide-y divide-zinc-800/70">
          {rows.map((r, i) => (
            <div key={r.paragraph} className="flex items-center gap-3 px-3 py-2">
              <span className="w-5 font-mono text-[10px] text-zinc-500">#{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[11px] text-zinc-200">{para(r.paragraph)}</span>
                  <span className="truncate text-xs text-zinc-400">{r.heading}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Bar value={(r.paragraph_cosine - min) / Math.max(1e-6, max - min)} color={ARM.dense} />
                </div>
              </div>
              <div className="w-20 text-right">
                <div className="font-mono text-[11px] tabular-nums text-zinc-100">{r.paragraph_cosine.toFixed(4)}</div>
                {r.best_chunk_cosine !== null && (
                  <div className="font-mono text-[10px] tabular-nums text-zinc-500">chunk {r.best_chunk_cosine.toFixed(4)}</div>
                )}
              </div>
            </div>
          ))}
        </Card>
        <p className="text-[11px] text-zinc-500">Bars are scaled from the lowest to the highest cosine in the index ({min.toFixed(3)}-{max.toFixed(3)}), so small differences stay visible.</p>
      </Section>

      <ScopeGate data={data} />
    </div>
  )
}
