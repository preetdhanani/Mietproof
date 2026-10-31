import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'

interface StageCardProps {
  title: string
  subtitle?: string
  icon: ReactNode
  accent?: string
  badge?: string
  defaultOpen?: boolean
  children: ReactNode
}

export function StageCard({
  title,
  subtitle,
  icon,
  accent = 'bg-zinc-800 text-zinc-300',
  badge,
  defaultOpen = false,
  children,
}: StageCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800/50 transition-colors text-left"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-zinc-100">{title}</span>
          {subtitle && <span className="block text-xs text-zinc-500 truncate">{subtitle}</span>}
        </span>
        {badge && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            {badge}
          </span>
        )}
        {open ? (
          <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-zinc-800/80">{children}</div>}
    </div>
  )
}
