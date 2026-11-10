import { Check, ChevronRight, CircleAlert, CloudOff, FolderLock, MapPinned, Settings as SettingsIcon, Siren, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Helplines } from '../components/Helplines'
import { LiveShareCard } from '../components/LiveShareCard'
import { SafetyEventList } from '../components/SafetyEvents'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { HoldRing } from '../components/ui/HoldRing'
import { SkeletonList } from '../components/ui/Spinner'
import { ErrorState, Notice } from '../components/ui/States'
import { AvatarStack, StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useAsync } from '../hooks/useAsync'
import { useGeolocation } from '../hooks/useGeolocation'
import { useSosTrigger } from '../hooks/useSosTrigger'
import { SyncChip } from '../layouts/AppShell'
import { api } from '../services/api'
import { cx, plural } from '../utils/format'

function CheckRow({ ok, label, detail, to, action }: { ok: boolean; label: string; detail: string; to?: string; action?: ReactNode }) {
  const body = (
    <>
      <span className={cx('grid size-9 shrink-0 place-items-center rounded-full', ok ? 'bg-mint text-green-ink' : 'bg-amber-wash text-amber-ink')} aria-hidden="true">
        {ok ? <Check size={18} strokeWidth={2.6} /> : <CircleAlert size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm text-soft">{detail}</span>
      </span>
    </>
  )
  return (
    <li className="border-t border-line first:border-t-0">
      {to ? (
        <Link to={to} className="flex min-h-14 items-center gap-3 py-2.5 hover:bg-bg">
          {body}
          <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
        </Link>
      ) : (
        <div className="flex min-h-14 flex-wrap items-center gap-3 py-2.5">
          {body}
          {action}
        </div>
      )}
    </li>
  )
}

function SummaryLink({ to, icon, title, children }: { to: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-[4.5rem] items-center gap-3 rounded-card bg-card p-4 shadow-card transition-colors duration-150 hover:bg-bg">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-mint-soft text-green-ink" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-soft">{children}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
    </Link>
  )
}

export function Home() {
  const { offline } = useSession()
  const sendAlert = useSosTrigger()
  const { permission, request } = useGeolocation()

  const overview = useAsync(
    async () => {
      const [contacts, zones, history, share, vault] = await Promise.all([
        api.contacts(),
        api.zones(),
        api.sosHistory(),
        api.liveShare(),
        api.vaultMeta(),
      ])
      return { contacts, zones: zones.zones, history, share, vaultReady: vault.configured }
    },
    [],
    !offline,
  )
  const data = overview.data

  const emergency = data?.contacts.filter((c) => c.is_emergency) ?? []
  const activeZones = data?.zones.filter((z) => z.enabled) ?? []
  const checks = data
    ? [emergency.length > 0, permission === 'granted', data.vaultReady]
    : []
  const missing = checks.filter((ok) => !ok).length

  return (
    <div className="grid gap-4">
      <header className="-mx-4 -mt-4 rounded-b-[2rem] bg-gradient-to-b from-mint to-mint-soft px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] md:mx-0 md:mt-0 md:rounded-[2rem] md:px-6 md:pt-6">
        <div className="flex items-center gap-2 pr-24 md:pr-0">
          <Link to="/settings" aria-label="Safety and settings" title="Safety and settings" className="grid size-11 place-items-center rounded-full bg-white/70 text-ink hover:bg-white">
            <SettingsIcon size={20} aria-hidden="true" />
          </Link>
          <SyncChip />
        </div>
        <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-sm font-semibold text-green-ink">Your safety space</p>
            <h1 className="mt-1 text-[28px] font-bold leading-tight text-green-deep">
              {offline ? 'You’re offline' : !data ? 'Checking your setup…' : missing ? `${plural(missing, 'thing')} to set up` : 'Ready when you need it'}
            </h1>
            <p className="mt-1.5 text-[15px] text-green-ink">
              {offline
                ? 'Alerts and new evidence wait on this phone and send when you’re back online.'
                : 'Hold the button for 2 seconds to alert your trusted contacts. Nothing shows on this phone.'}
            </p>
          </div>
          <HoldRing label="Hold for 2 seconds to send a silent alert" hint="Hold 2 seconds" size="md" onFire={sendAlert}>
            <Siren size={26} className="text-danger-strong" aria-hidden="true" />
            <span className="text-sm font-bold tracking-wide">SOS</span>
          </HoldRing>
        </div>
      </header>

      {offline && (
        <Notice tone="warn" icon={<CloudOff size={18} />}>
          Contacts, zones and your stored evidence need a connection. Exit and unlock again once you’re online to see them.
        </Notice>
      )}

      {!offline && overview.loading && !data && <SkeletonList rows={3} />}
      {!offline && overview.failed && <ErrorState onRetry={overview.reload}>Couldn’t load your overview. Alerts still work.</ErrorState>}

      {data && (
        <>
          <LiveShareCard share={data.share} onEnded={overview.reload} />

          <Card aria-labelledby="status-title">
            <CardTitle id="status-title" action={<StatusChip tone={missing ? 'warn' : 'ok'}>{missing ? 'Needs attention' : 'All set'}</StatusChip>}>
              Safety status
            </CardTitle>
            <ul>
              <CheckRow
                ok={emergency.length > 0}
                label="Trusted contacts"
                detail={emergency.length ? `${plural(emergency.length, 'emergency contact')} will be alerted` : 'An alert won’t reach anyone until you add an emergency contact'}
                to="/contacts"
              />
              <CheckRow
                ok={permission === 'granted'}
                label="Location"
                detail={
                  permission === 'granted'
                    ? 'Alerts will say where you are'
                    : permission === 'denied'
                      ? 'Blocked in your browser’s site settings, so alerts won’t say where you are'
                      : 'Off, so alerts won’t say where you are'
                }
                action={
                  permission === 'prompt' ? (
                    <Button variant="secondary" size="sm" onClick={() => void request()}>
                      Allow location
                    </Button>
                  ) : undefined
                }
              />
              <CheckRow
                ok={data.vaultReady}
                label="Evidence vault"
                detail={data.vaultReady ? 'Encrypted and ready' : 'Not set up yet'}
                to="/vault"
              />
            </ul>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryLink to="/contacts" icon={<Users size={20} />} title="Trusted contacts">
              {data.contacts.length ? (
                <span className="mt-1 flex items-center gap-2">
                  <AvatarStack names={data.contacts.map((c) => c.name)} max={3} />
                  {plural(data.contacts.length, 'person', 'people')}
                </span>
              ) : (
                'Nobody added yet'
              )}
            </SummaryLink>
            <SummaryLink to="/location/zones" icon={<MapPinned size={20} />} title="Safe and danger zones">
              {activeZones.length
                ? `${plural(activeZones.filter((z) => z.kind === 'safe').length, 'safe zone')}, ${plural(activeZones.filter((z) => z.kind === 'danger').length, 'danger zone')} watched`
                : 'No zones being watched'}
            </SummaryLink>
            <SummaryLink to="/vault" icon={<FolderLock size={20} />} title="Evidence vault">
              {data.vaultReady ? 'Notes, photos and audio, encrypted' : 'Set a passphrase to start'}
            </SummaryLink>
            <SummaryLink to="/sos" icon={<Siren size={20} />} title="SOS">
              {data.history.length ? 'See how your last alert went' : 'No alerts sent yet'}
            </SummaryLink>
          </div>

          <Card aria-labelledby="events-title">
            <CardTitle id="events-title">Recent safety events</CardTitle>
            {data.history.length ? (
              <SafetyEventList items={data.history.slice(0, 4)} />
            ) : (
              <p className="text-[15px] text-soft">Alerts you send and location shares you start will be listed here.</p>
            )}
          </Card>
        </>
      )}

      <Helplines />
    </div>
  )
}
