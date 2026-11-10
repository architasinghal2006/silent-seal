import { Check, CircleAlert, Clock, Siren, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { deliveryLabel, SafetyEventList } from '../components/SafetyEvents'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { HoldRing } from '../components/ui/HoldRing'
import { Spinner } from '../components/ui/Spinner'
import { StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useAsync } from '../hooks/useAsync'
import { useGeolocation } from '../hooks/useGeolocation'
import { useOnline } from '../hooks/useOnline'
import { useSosTrigger, type SosAttempt } from '../hooks/useSosTrigger'
import { api } from '../services/api'
import type { SosOutcome } from '../services/sos'
import type { SosStatus } from '../types/api'
import { cx, formatTime, plural } from '../utils/format'

const POLL_MS = 2000
const POLL_FOR_MS = 60_000

type StepState = 'done' | 'working' | 'waiting' | 'problem'

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cx(
          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
          state === 'done' && 'bg-green text-green-deep',
          state === 'working' && 'bg-fill text-ink',
          state === 'waiting' && 'bg-amber-wash text-amber-ink',
          state === 'problem' && 'bg-danger-wash text-danger-ink',
        )}
        aria-hidden="true"
      >
        {state === 'done' && <Check size={18} strokeWidth={2.6} />}
        {state === 'working' && <Spinner size={16} />}
        {state === 'waiting' && <Clock size={16} />}
        {state === 'problem' && <X size={18} strokeWidth={2.6} />}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-[15px] text-soft">{children}</div>}
      </div>
    </li>
  )
}

/**
 * How one alert is going. Each line is confirmed by the server before it is shown as done.
 * The phone alone never decides that something was sent or delivered.
 */
function AlertProgress({ attempt, onReturn }: { attempt: SosAttempt; onReturn: () => void }) {
  const [outcome, setOutcome] = useState<SosOutcome | null>(null)
  const [status, setStatus] = useState<SosStatus | null>(null)

  useEffect(() => {
    let current = true
    void attempt.outcome.then((result) => {
      if (current) setOutcome(result)
    })
    return () => {
      current = false
    }
  }, [attempt])

  const eventId = outcome?.state === 'sent' ? outcome.eventId : null
  useEffect(() => {
    if (!eventId) return
    let current = true
    const load = () =>
      api
        .sosStatus(eventId)
        .then((next) => {
          if (current) setStatus(next)
        })
        .catch(() => undefined)
    void load()
    const timer = setInterval(load, POLL_MS)
    const stop = setTimeout(() => clearInterval(timer), POLL_FOR_MS)
    return () => {
      current = false
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [eventId])

  const settled = status && status.status !== 'queued'

  return (
    <Card aria-labelledby="progress-title" aria-live="polite">
      <CardTitle id="progress-title">Alert started at {formatTime(new Date(attempt.startedAt))}</CardTitle>
      <ol className="grid gap-4">
        {!outcome && <Step state="working" title="Sending your alert…" />}
        {outcome?.state === 'failed' && (
          <Step state="problem" title="The alert could not be sent or saved">
            Try again. If you are in immediate danger, call 112.
          </Step>
        )}
        {outcome?.state === 'queued' && (
          <>
            <Step state="waiting" title="Saved on this phone, not sent yet">
              There’s no connection. It will send by itself when you’re back online, as long as this app is open. Nobody has been told yet.
            </Step>
            <Step state="waiting" title="Contacts will be notified after it sends" />
          </>
        )}
        {outcome?.state === 'sent' && (
          <>
            <Step state="done" title="Alert received by the server" />
            <Step state={status?.location_captured ? 'done' : status ? 'waiting' : 'working'} title={status?.location_captured ? 'Location captured' : 'Location not captured yet'}>
              {status && !status.location_captured && 'If location is off or slow, the alert has gone without it and will be updated if a position arrives.'}
              {status?.battery != null && ` Phone battery ${Math.round(status.battery * 100)}%.`}
            </Step>
            {!settled && <Step state="working" title="Notifying your emergency contacts…" />}
            {settled && status.status === 'no_contacts' && (
              <Step state="problem" title="Nobody was notified">
                You have no emergency contacts. <Link to="/contacts" className="font-semibold text-ink underline">Add one</Link> so an alert reaches someone.
              </Step>
            )}
            {settled && status.status !== 'no_contacts' && (
              <Step state={status.deliveries.some((d) => d.status === 'sent') ? 'done' : 'problem'} title={`${plural(status.deliveries.length, 'notification')} processed`}>
                <ul className="mt-1 grid gap-2">
                  {status.deliveries.map((delivery, i) => {
                    const label = deliveryLabel(delivery)
                    return (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{delivery.contact_name}</span>
                        <span className="text-sm uppercase">{delivery.channel}</span>
                        <StatusChip tone={label.tone}>{label.text}</StatusChip>
                      </li>
                    )
                  })}
                </ul>
              </Step>
            )}
            {status && (
              <Step state={status.live_share_active ? 'done' : 'waiting'} title={status.live_share_active ? 'Live location sharing is on' : 'Live location sharing is not on'}>
                {status.live_share_active && (
                  <>
                    Your contacts have a private map. <Link to="/location" className="font-semibold text-ink underline">Open your map</Link>
                  </>
                )}
              </Step>
            )}
          </>
        )}
      </ol>
      <Button variant="dark" block className="mt-5" onClick={onReturn}>
        Return to calculator
      </Button>
    </Card>
  )
}

function Ready({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[15px]">
      {ok ? <Check size={18} className="shrink-0 text-green-ink" aria-hidden="true" /> : <CircleAlert size={18} className="shrink-0 text-amber-ink" aria-hidden="true" />}
      <span className={ok ? 'text-ink' : 'text-amber-ink'}>{children}</span>
    </li>
  )
}

export function Sos() {
  const { offline, lock } = useSession()
  const online = useOnline()
  const sendAlert = useSosTrigger()
  const { permission } = useGeolocation()
  const attempt = (useLocation().state as { attempt?: SosAttempt } | null)?.attempt

  const readiness = useAsync(async () => ({ contacts: await api.contacts(), history: await api.sosHistory() }), [attempt], !offline)
  const emergency = readiness.data?.contacts.filter((c) => c.is_emergency).length

  return (
    <div className="grid gap-4">
      <section className="-mx-4 -mt-4 flex flex-col items-center rounded-b-[2rem] bg-gradient-to-b from-mint to-mint-soft px-4 pb-8 pt-[max(4.5rem,env(safe-area-inset-top))] text-center md:mx-0 md:mt-0 md:rounded-[2rem] md:pt-10">
        <h1 className="text-[28px] font-bold leading-tight text-green-deep">Silent SOS</h1>
        <p className="mt-1.5 max-w-[34ch] text-[15px] text-green-ink">
          Alerts your emergency contacts with your location and starts a private live map. No sound, no message on this phone.
        </p>

        <div className="relative my-8 grid size-64 place-items-center">
          {/* Concentric rings: a calm radar, not an alarm. */}
          <span className="absolute inset-0 rounded-full border border-green/25" aria-hidden="true" />
          <span className="absolute inset-7 rounded-full border border-green/30 bg-white/30" aria-hidden="true" />
          <span className="absolute inset-10 animate-radar rounded-full bg-green/20 motion-reduce:hidden" aria-hidden="true" />
          <HoldRing label="Hold for 2 seconds to send a silent alert" hint="Hold 2 seconds" onFire={sendAlert}>
            <Siren size={34} className="text-danger-strong" aria-hidden="true" />
            <span className="text-lg font-bold tracking-[0.2em]">HOLD FOR SOS</span>
          </HoldRing>
        </div>

        <ul className="grid gap-2 text-left">
          {!offline && emergency !== undefined && (
            <Ready ok={emergency > 0}>{emergency > 0 ? `${plural(emergency, 'emergency contact')} will be alerted` : 'No emergency contacts: nobody would be alerted'}</Ready>
          )}
          <Ready ok={permission === 'granted'}>{permission === 'granted' ? 'Your location will be included' : 'Location is off: the alert goes without it'}</Ready>
          <Ready ok={online && !offline}>{online && !offline ? 'Connected' : 'No connection: the alert waits on this phone until you’re online'}</Ready>
        </ul>
      </section>

      {attempt && <AlertProgress attempt={attempt} onReturn={lock} />}

      {!attempt && (
        <Card tone="flat">
          <p className="text-[15px] text-soft">
            After you send an alert, this app returns to the calculator straight away and shows nothing. To watch the alert’s progress instead, turn
            on <Link to="/settings" className="font-semibold text-ink underline">Stay on the status screen</Link> in Settings.
          </p>
        </Card>
      )}

      {readiness.data && readiness.data.history.length > 0 && (
        <Card aria-labelledby="sos-history-title">
          <CardTitle id="sos-history-title">Earlier alerts</CardTitle>
          <SafetyEventList items={readiness.data.history} />
        </Card>
      )}
    </div>
  )
}
