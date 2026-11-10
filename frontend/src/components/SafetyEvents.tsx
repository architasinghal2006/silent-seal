import { MapPin, MapPinned, ShieldAlert, Siren } from 'lucide-react'
import type { DeliveryStatus, SosHistoryItem } from '../types/api'
import { formatDateTime, parseServerTime, plural } from '../utils/format'
import { StatusChip, type Tone } from './ui/StatusChip'

const TRIGGERS: Record<string, { label: string; icon: typeof Siren }> = {
  manual: { label: 'Silent alert', icon: Siren },
  duress: { label: 'Duress PIN alert', icon: ShieldAlert },
  geofence: { label: 'Zone alert', icon: MapPinned },
  share: { label: 'Location shared', icon: MapPin },
}

export function triggerLabel(trigger: string): string {
  return TRIGGERS[trigger]?.label ?? 'Alert'
}

/** What happened to an alert, in plain words. Never claims a delivery the server didn't confirm. */
export function outcomeOf(item: SosHistoryItem): { text: string; tone: Tone } {
  // Sample history is there to fill the screen. It was never an alert, so it never reads as one that was sent.
  if (item.simulated) return { text: 'Sample data: nothing was sent', tone: 'simulated' }
  if (item.status === 'queued') return { text: 'Being sent', tone: 'neutral' }
  if (item.status === 'no_contacts') return { text: 'Nobody was told: no emergency contacts then', tone: 'warn' }
  if (item.delivered === 0) return { text: 'Not delivered', tone: 'danger' }
  const missed = item.undelivered ? `, ${item.undelivered} not delivered` : ''
  return { text: `Sent to ${plural(item.delivered, 'contact')}${missed}`, tone: item.undelivered ? 'warn' : 'ok' }
}

/**
 * How one message to one contact went. The mock adapter records messages without sending
 * them, and the SMS and email adapters are stubs, so neither is ever shown as delivered.
 */
export function deliveryLabel(delivery: DeliveryStatus): { text: string; tone: Tone } {
  if (delivery.status === 'pending') return { text: 'Waiting', tone: 'neutral' }
  if (delivery.adapter === 'sample') return { text: 'Sample data: nothing sent', tone: 'simulated' }
  if (delivery.adapter === 'mock') return { text: 'Simulated: recorded, not sent', tone: 'simulated' }
  if (delivery.status === 'sent') return { text: 'Sent', tone: 'ok' }
  if (delivery.status === 'stub') return { text: 'Not sent: provider is a stub', tone: 'warn' }
  return { text: 'Not sent', tone: 'danger' }
}

export function SafetyEventList({ items }: { items: SosHistoryItem[] }) {
  return (
    <ul className="grid">
      {items.map((item) => {
        const { icon: Icon } = TRIGGERS[item.trigger] ?? TRIGGERS.manual
        const outcome = outcomeOf(item)
        return (
          <li key={item.id} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink" aria-hidden="true">
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {triggerLabel(item.trigger)}
                {item.simulated && <StatusChip tone="simulated">Sample</StatusChip>}
              </p>
              <p className="text-sm text-soft">{formatDateTime(parseServerTime(item.created_at))}</p>
              <p className="mt-1">
                <StatusChip tone={outcome.tone}>{outcome.text}</StatusChip>
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
