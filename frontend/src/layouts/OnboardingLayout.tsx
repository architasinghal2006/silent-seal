import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { QuickExit } from '../components/QuickExit'
import { IconButton } from '../components/ui/Button'
import { cx } from '../utils/format'

interface Props {
  step: number
  steps: number
  title: string
  lede?: ReactNode
  onBack?: () => void
  onSkip?: () => void
  onExit: () => void
  /** The illustration above the title. Decorative. */
  art?: ReactNode
  children: ReactNode
  /** The main action, pinned to the bottom of the screen. */
  footer: ReactNode
}

/** The soft blush frame for first-time setup: progress, one idea per screen, one main action. */
export function OnboardingLayout({ step, steps, title, lede, onBack, onSkip, onExit, art, children, footer }: Props) {
  return (
    <div className="min-h-full bg-gradient-to-b from-blush via-blush-wash to-bg">
      <QuickExit onExit={onExit} />
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-h-11 items-center gap-3 pr-24">
          {onBack ? (
            <IconButton label="Back" onClick={onBack} className="-ml-2">
              <ArrowLeft size={22} aria-hidden="true" />
            </IconButton>
          ) : (
            <span className="w-1" />
          )}
          <ol className="flex flex-1 items-center gap-1.5" aria-label={`Step ${step} of ${steps}`}>
            {Array.from({ length: steps }, (_, i) => (
              <li key={i} className={cx('h-1.5 rounded-full transition-all duration-200', i + 1 === step ? 'w-7 bg-pink' : i + 1 < step ? 'w-3 bg-pink/50' : 'w-3 bg-white')} />
            ))}
          </ol>
        </div>

        <div className="flex flex-1 flex-col pt-6">
          {art && (
            <div className="mb-6 flex justify-center" aria-hidden="true">
              {art}
            </div>
          )}
          <h1 className="text-center text-[28px] font-bold leading-tight">{title}</h1>
          {lede && <p className="mx-auto mt-2 max-w-[36ch] text-center text-[15px] text-soft">{lede}</p>}
          <div className="mt-6 grid gap-4">{children}</div>
        </div>

        <div className="sticky bottom-0 -mx-5 mt-6 grid gap-2 bg-gradient-to-t from-bg via-bg to-transparent px-5 pb-1 pt-6">
          {footer}
          {onSkip && (
            <button type="button" onClick={onSkip} className="min-h-11 rounded-full text-[15px] font-semibold text-soft hover:text-ink">
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
