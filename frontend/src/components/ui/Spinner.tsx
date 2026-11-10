import { cx } from '../../utils/format'

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** A whole-area loading state, announced to screen readers. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-soft">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

/** Grey placeholder blocks shown while a list loads, so the layout doesn't jump. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-card bg-card p-4 shadow-card">
          <div className="size-12 rounded-full bg-fill" />
          <div className="grid flex-1 gap-2">
            <div className="h-3.5 w-2/5 rounded-full bg-fill" />
            <div className="h-3 w-3/5 rounded-full bg-fill" />
          </div>
        </div>
      ))}
    </div>
  )
}
