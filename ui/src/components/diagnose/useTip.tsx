import { useState, type ReactNode } from 'react'

/** Hover tooltip for SVG/HTML charts: wrap the chart, call show() from marks. */
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null)
  const show = (e: React.MouseEvent, content: ReactNode) => {
    const box = (e.currentTarget as Element).closest('[data-tip-root]')?.getBoundingClientRect()
    if (!box) return
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content })
  }
  const hide = () => setTip(null)
  const node = tip && (
    <div
      className="pointer-events-none absolute z-20 max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-200 shadow-xl backdrop-blur"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      {tip.content}
    </div>
  )
  return { show, hide, node }
}
