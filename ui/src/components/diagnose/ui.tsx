// Small building blocks shared by the diagnose tabs.

import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Info, Loader2, MinusCircle, XCircle } from 'lucide-react'
import type { StepStatus } from '../../lib/pipeline'

export function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string
  hint?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <header className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">{title}</h3>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{hint}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-800 bg-zinc-900/50 ${className}`}>{children}</div>
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-base font-medium tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-zinc-500">{sub}</div>}
    </div>
  )
}

const TONES = {
  info: { box: 'border-zinc-700/80 bg-zinc-900', icon: <Info className="h-4 w-4 text-zinc-400" /> },
  pass: { box: 'border-emerald-500/25 bg-emerald-500/5', icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
  warn: { box: 'border-amber-500/25 bg-amber-500/5', icon: <AlertTriangle className="h-4 w-4 text-amber-400" /> },
  fail: { box: 'border-rose-500/25 bg-rose-500/5', icon: <XCircle className="h-4 w-4 text-rose-400" /> },
}

export function Callout({ tone = 'info', title, children }: { tone?: keyof typeof TONES; title?: string; children: ReactNode }) {
  const t = TONES[tone]
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3 py-2.5 ${t.box}`}>
      <span className="mt-px shrink-0">{t.icon}</span>
      <div className="min-w-0 text-xs leading-relaxed text-zinc-300">
        {title && <p className="mb-0.5 font-medium text-zinc-100">{title}</p>}
        {children}
      </div>
    </div>
  )
}

/** A formula or exact string, shown as code. */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300 ${className}`}>
      {children}
    </div>
  )
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-800/70 px-1.5 py-px font-mono text-[10px] text-zinc-300 ${className}`}>
      {children}
    </span>
  )
}

export function Swatch({ color, shape = 'square' }: { color: string; shape?: 'square' | 'dot' | 'line' }) {
  const cls = shape === 'dot' ? 'h-2 w-2 rounded-full' : shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-[2px]'
  return <span className={`inline-block shrink-0 ${cls}`} style={{ background: color }} />
}

export function Legend({ items }: { items: Array<{ color: string; label: string; shape?: 'square' | 'dot' | 'line' }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
          <Swatch color={item.color} shape={item.shape} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function StatusIcon({ status, className = 'h-3.5 w-3.5' }: { status: StepStatus; className?: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className={`${className} text-emerald-400`} />
    case 'warn':
      return <AlertTriangle className={`${className} text-amber-400`} />
    case 'fail':
      return <XCircle className={`${className} text-rose-400`} />
    case 'running':
      return <Loader2 className={`${className} animate-spin text-zinc-200`} />
    case 'skipped':
      return <MinusCircle className={`${className} text-zinc-600`} />
    default:
      return <Circle className={`${className} text-zinc-700`} />
  }
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs leading-relaxed text-zinc-500">
      {children}
    </div>
  )
}

/** Horizontal bar used in tables; value in [0, 1]. */
export function Bar({ value, color, className = 'h-1.5' }: { value: number; color: string; className?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  )
}
