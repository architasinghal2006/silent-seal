import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/format'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'safe' | 'secondary' | 'ghost' | 'danger' | 'dark'
type Size = 'md' | 'lg' | 'sm'

const VARIANTS: Record<Variant, string> = {
  // Dark ink on the brand colours: white on them fails contrast.
  primary: 'bg-pink text-pink-deep hover:brightness-95 active:brightness-90',
  safe: 'bg-green text-green-deep hover:brightness-95 active:brightness-90',
  secondary: 'bg-fill text-ink hover:bg-line active:bg-line',
  ghost: 'bg-transparent text-ink hover:bg-fill active:bg-fill',
  danger: 'bg-danger-strong text-white hover:brightness-95 active:brightness-90',
  dark: 'bg-ink text-white hover:brightness-110 active:brightness-125',
}

const SIZES: Record<Size, string> = {
  sm: 'min-h-10 px-4 text-sm',
  md: 'min-h-12 px-5 text-[15px]',
  lg: 'min-h-14 px-6 text-base',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Shows a spinner and blocks further presses. Keep the label describing what is happening. */
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, block, icon, className, children, disabled, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[filter,background-color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Read by screen readers, and shown as a tooltip. Required: the button has no visible text. */
  label: string
  tone?: 'plain' | 'card' | 'dark'
}

export function IconButton({ label, tone = 'plain', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-150 disabled:opacity-50',
        tone === 'plain' && 'text-ink hover:bg-fill',
        tone === 'card' && 'bg-card text-ink shadow-key hover:bg-fill',
        tone === 'dark' && 'bg-white/10 text-white hover:bg-white/20',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
