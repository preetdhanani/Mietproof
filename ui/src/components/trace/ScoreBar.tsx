interface ScoreBarProps {
  label: string
  score: number
  max?: number
  color?: string
  detail?: string
  hoverText?: string
}

export function ScoreBar({ label, score, max = 1, color = 'bg-emerald-600', detail, hoverText }: ScoreBarProps) {
  const pct = Math.max(2, Math.min(100, (score / max) * 100))
  return (
    <div className="flex items-center gap-2 group/bar" title={hoverText}>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-400">§{label}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-200 group-hover/bar:brightness-125`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 shrink-0 font-mono text-[11px] text-zinc-200 tabular-nums">{score.toFixed(3)}</span>
      {detail && <span className="text-[10px] text-zinc-400">{detail}</span>}
    </div>
  )
}
