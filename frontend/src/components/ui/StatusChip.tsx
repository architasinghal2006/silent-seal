import type { ReactNode } from 'react'
import { cx, initials } from '../../utils/format'

export type Tone = 'ok' | 'neutral' | 'warn' | 'danger' | 'simulated' | 'dark'

const TONES: Record<Tone, string> = {
  ok: 'bg-mint text-green-ink',
  neutral: 'bg-fill text-soft',
  warn: 'bg-amber-wash text-amber-ink',
  danger: 'bg-danger-wash text-danger-ink',
  simulated: 'bg-blush text-pink-ink',
  dark: 'bg-ink text-white',
}

/** A short status label. Colour is never the only signal: the text always says what it means. */
export function StatusChip({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold leading-none', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

const AVATAR_TONES = ['bg-mint text-green-ink', 'bg-blush text-pink-ink', 'bg-amber-wash text-amber-ink', 'bg-fill text-ink']

/** Initials on a soft colour chosen from the name, so the same person always looks the same. */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-full font-bold ring-2 ring-card',
        size === 'sm' && 'size-9 text-xs',
        size === 'md' && 'size-12 text-sm',
        size === 'lg' && 'size-14 text-base',
        AVATAR_TONES[hash % AVATAR_TONES.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max)
  return (
    <span className="flex items-center">
      {shown.map((name, i) => (
        <Avatar key={`${name}-${i}`} name={name} size="sm" className={i ? '-ml-2.5' : ''} />
      ))}
      {names.length > max && (
        <span className="-ml-2.5 inline-grid size-9 place-items-center rounded-full bg-ink text-xs font-bold text-white ring-2 ring-card">
          +{names.length - max}
        </span>
      )}
    </span>
  )
}
