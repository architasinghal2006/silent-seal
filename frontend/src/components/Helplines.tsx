import { Phone } from 'lucide-react'
import { Card, CardTitle } from './ui/Card'

export const HELPLINES = [
  { number: '112', label: 'Emergency Response Support System', detail: 'Police, fire, ambulance' },
  { number: '181', label: 'Women Helpline', detail: 'Support and referral for women' },
  { number: '1098', label: 'Child Helpline', detail: 'For a child in need of care or protection' },
]

/** India's public emergency numbers. These are outside services: this app does not run or contact them. */
export function Helplines({ tone = 'card' }: { tone?: 'card' | 'blush' }) {
  return (
    <Card tone={tone} aria-labelledby="helplines-title">
      <CardTitle id="helplines-title">Emergency helplines (India)</CardTitle>
      <ul className="grid gap-2">
        {HELPLINES.map((h) => (
          <li key={h.number}>
            <a href={`tel:${h.number}`} className="flex min-h-14 items-center gap-4 rounded-control bg-bg px-4 py-2.5 transition-colors duration-150 hover:bg-fill">
              <span className="w-14 text-2xl font-bold tabular-nums text-green-ink">{h.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{h.label}</span>
                <span className="block text-sm text-soft">{h.detail}</span>
              </span>
              <Phone size={20} className="shrink-0 text-muted" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-soft">
        These are external public services, not part of this app. Silent Seal complements emergency services and does not replace them or
        guarantee your safety. If you are in immediate danger, call 112.
      </p>
    </Card>
  )
}
