import type { CSSProperties } from 'react'

/** Stagger helper: animation class + delay when animating, nothing otherwise. */
export function anim(animate: boolean, cls: string, delayMs = 0): { className: string; style?: CSSProperties } {
  return animate ? { className: cls, style: { animationDelay: `${delayMs}ms` } } : { className: '' }
}
