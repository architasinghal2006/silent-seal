import { createElement, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from '../../utils/format'

type Tone = 'card' | 'mint' | 'blush' | 'flat'

const TONES: Record<Tone, string> = {
  card: 'bg-card shadow-card',
  mint: 'bg-mint-soft',
  blush: 'bg-blush',
  flat: 'bg-fill',
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: Tone
  as?: 'section' | 'div' | 'article' | 'li' | 'form'
  padded?: boolean
}

export function Card({ tone = 'card', as: Tag = 'section', padded = true, className, children, ...rest }: CardProps) {
  // The element type varies, so it is created directly rather than through JSX's per-tag prop types.
  return createElement(Tag, { className: cx('rounded-card', padded && 'p-5', TONES[tone], className), ...rest }, children)
}

export function CardTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="text-[17px] font-semibold">
        {children}
      </h2>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3 pr-20 md:pr-0">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-soft">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
