import { cx } from '../../utils/format'

interface Option<T extends string> {
  value: T
  label: string
}

/** A small set of mutually exclusive choices, shown side by side. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  tone = 'pink',
}: {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  tone?: 'pink' | 'mint'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-fill p-1">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              'min-h-11 rounded-full px-4 text-[15px] font-semibold transition-colors duration-150',
              selected ? (tone === 'pink' ? 'bg-pink text-pink-deep shadow-key' : 'bg-mint text-green-deep shadow-key') : 'text-soft hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
