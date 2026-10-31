interface ScoreBarProps {
  label: string
  score: number
  max?: number
  color?: string
  detail?: string
}

export function ScoreBar({ label, score, max = 1, color = 'bg-emerald-500', detail }: ScoreBarProps) {
  const pct = Math.max(2, Math.min(100, (score / max) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-500">§{label}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 font-mono text-[11px] text-zinc-300">{score.toFixed(3)}</span>
      {detail && <span className="text-[10px] text-zinc-600">{detail}</span>}
    </div>
  )
}
