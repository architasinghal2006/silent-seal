import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '../../utils/format'

const CONTROL =
  'w-full rounded-control border border-line bg-card px-4 text-base text-ink placeholder:text-muted ' +
  'transition-colors duration-150 focus:border-ink disabled:bg-fill disabled:text-soft aria-[invalid=true]:border-danger-strong'

interface Shell {
  label: string
  hint?: ReactNode
  error?: string
}

function FieldShell({ id, label, hint, error, children }: Shell & { id: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger-ink">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-soft">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

function describedBy(id: string, hint: ReactNode, error?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined
}

export function TextField({ label, hint, error, className, ...rest }: Shell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        autoComplete="off"
        className={cx(CONTROL, 'min-h-12', className)}
        {...rest}
      />
    </FieldShell>
  )
}

/** Digits only, hidden as typed. For PINs and the secret sequence. */
export function DigitsField({
  label,
  hint,
  error,
  value,
  onValue,
  maxLength = 8,
  ...rest
}: Shell & { value: string; onValue: (digits: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        onChange={(e) => onValue(e.target.value.replace(/\D/g, ''))}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(CONTROL, 'min-h-12 text-xl tracking-[0.35em]')}
        {...rest}
      />
    </FieldShell>
  )
}

export function TextArea({ label, hint, error, className, ...rest }: Shell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(CONTROL, 'resize-y py-3 leading-relaxed', className)}
        {...rest}
      />
    </FieldShell>
  )
}

export function SelectField({ label, hint, error, className, children, ...rest }: Shell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select id={id} aria-describedby={describedBy(id, hint, error)} className={cx(CONTROL, 'min-h-12 appearance-auto', className)} {...rest}>
        {children}
      </select>
    </FieldShell>
  )
}

/** An on/off setting with its explanation. The whole row is the control. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span id={`${id}-label`} className="block font-semibold">
          {label}
        </span>
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-sm text-soft">
            {hint}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50',
          checked ? 'bg-green' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'absolute left-1 top-1 size-6 rounded-full bg-white shadow-key transition-transform duration-150',
            checked && 'translate-x-6',
          )}
        />
      </button>
    </div>
  )
}
