import { CircleAlert, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../utils/format'
import { Button } from './Button'

/** Shown when a list has nothing in it yet. Always says what the thing is for and what to do next. */
export function EmptyState({ icon, title, children, action, tone = 'mint' }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode; tone?: 'mint' | 'blush' }) {
  return (
    <div className="flex flex-col items-center rounded-card bg-card px-6 py-10 text-center shadow-card">
      <span className={cx('mb-4 grid size-16 place-items-center rounded-full', tone === 'mint' ? 'bg-mint-soft text-green-ink' : 'bg-blush text-pink-ink')} aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1.5 max-w-[38ch] text-[15px] text-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Shown when something could not be loaded. Says what failed and offers the way forward. */
export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card bg-danger-wash p-5 text-danger-ink sm:flex-row sm:items-center">
      <CircleAlert className="shrink-0" size={22} aria-hidden="true" />
      <p className="flex-1 font-medium">{children}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RotateCw size={16} aria-hidden="true" />} onClick={onRetry} className="bg-white">
          Try again
        </Button>
      )}
    </div>
  )
}

type NoticeTone = 'info' | 'ok' | 'warn' | 'danger'

const NOTICE: Record<NoticeTone, string> = {
  info: 'bg-fill text-ink',
  ok: 'bg-mint-soft text-green-ink',
  warn: 'bg-amber-wash text-amber-ink',
  danger: 'bg-danger-wash text-danger-ink',
}

/** An inline message inside a page. Errors interrupt screen readers; the rest wait their turn. */
export function Notice({ tone = 'info', icon, children, action }: { tone?: NoticeTone; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control px-4 py-3 text-[15px] font-medium', NOTICE[tone])}>
      {icon && <span className="shrink-0" aria-hidden="true">{icon}</span>}
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  )
}
