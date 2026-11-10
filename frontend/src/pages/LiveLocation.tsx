import { Copy, MapPin, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ImSafeButton } from '../components/LiveShareCard'
import { LocationTabs } from '../components/LocationTabs'
import { MapView } from '../components/MapView'
import { Button } from '../components/ui/Button'
import { Card, CardTitle, PageHeader } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Loading } from '../components/ui/Spinner'
import { ErrorState, Notice } from '../components/ui/States'
import { Avatar, StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useToast } from '../contexts/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useGeolocation } from '../hooks/useGeolocation'
import { readBattery } from '../geolocation/device'
import { distanceMetres } from '../geolocation/geofence'
import { api } from '../services/api'
import { startStream } from '../services/liveStream'
import type { TrailPoint } from '../types/api'
import { formatDistance, formatDuration, formatTime, parseServerTime, timeAgo } from '../utils/format'

const REFRESH_MS = 10_000

function trailLength(points: TrailPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMetres(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
  return total
}

export function LiveLocation() {
  const { offline } = useSession()
  const toast = useToast()
  const { permission, position, request } = useGeolocation()
  const share = useAsync(() => api.liveShare(), [], !offline)
  const [now, setNow] = useState(Date.now())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const status = share.data
  const active = status?.active ?? false

  // While sharing, keep the trail and the clock current. Only while this screen is open.
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setNow(Date.now())
      api.liveShare().then(share.setData).catch(() => undefined)
    }, REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  async function start() {
    setBusy(true)
    setError('')
    try {
      const started = await api.startLiveShare(position, await readBattery())
      if (started.stream_token) startStream(started.stream_token)
      share.setData(started)
      setConfirming(false)
      toast('Sharing started')
    } catch {
      setError('Could not start sharing. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!status?.share_url) return
    try {
      await navigator.clipboard.writeText(status.share_url)
      toast('Link copied')
    } catch {
      toast('Could not copy the link', 'error')
    }
  }

  const points = status?.points ?? []
  const last = points[points.length - 1]
  const viewers = status?.viewers ?? []

  return (
    <div className="grid gap-4">
      <PageHeader title="Location" subtitle="Your location is shared only when you send an alert or start sharing yourself." />
      <LocationTabs />

      {offline && <Notice tone="warn">Sharing status needs a connection. A share that is already running keeps updating while this app is open.</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <MapView label="Map of your location and shared trail" position={position} trail={points} className="h-[46dvh] min-h-72 shadow-card lg:h-[70dvh]" />

        <div className="grid gap-4">
          {permission !== 'granted' && (
            <Notice
              tone="warn"
              icon={<MapPin size={18} />}
              action={
                permission === 'prompt' ? (
                  <Button variant="secondary" size="sm" className="bg-white" onClick={() => void request()}>
                    Allow location
                  </Button>
                ) : undefined
              }
            >
              {permission === 'denied'
                ? 'Location is blocked in your browser’s site settings, so your position can’t be shown or shared.'
                : permission === 'unsupported'
                  ? 'This browser can’t provide a location.'
                  : 'Location is off, so your position can’t be shown or shared.'}
            </Notice>
          )}

          {!offline && share.loading && !status && <Loading label="Checking sharing status…" />}
          {!offline && share.failed && <ErrorState onRetry={share.reload}>Couldn’t check whether you’re sharing.</ErrorState>}

          {status && (
            <Card aria-labelledby="share-title">
              <CardTitle id="share-title" action={<StatusChip tone={active ? 'ok' : 'neutral'} icon={active ? <Radio size={13} aria-hidden="true" /> : undefined}>{active ? 'Sharing live' : 'Not sharing'}</StatusChip>}>
                Live sharing
              </CardTitle>

              {active ? (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
                    <div>
                      <dt className="text-sm text-soft">Sharing for</dt>
                      <dd className="font-semibold tabular-nums">{status.started_at ? formatDuration(now - parseServerTime(status.started_at).getTime()) : 'A moment'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-soft">Link ends</dt>
                      <dd className="font-semibold tabular-nums">{status.expires_at ? formatTime(parseServerTime(status.expires_at)) : 'Soon'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-soft">Last update</dt>
                      <dd className="font-semibold">{last ? timeAgo(parseServerTime(last.at), now) : 'Waiting for a position'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-soft">Trail</dt>
                      <dd className="font-semibold tabular-nums">{points.length > 1 ? `${formatDistance(trailLength(points))}, ${points.length} points` : 'Just started'}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-sm text-soft">Updates stop if this app is closed or the phone locks. A web app can’t share location in the background.</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <ImSafeButton block onEnded={share.reload} />
                    <Button variant="secondary" icon={<Copy size={17} aria-hidden="true" />} onClick={() => void copyLink()}>
                      Copy contact link
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[15px] text-soft">Nobody can see where you are. Start sharing to give your emergency contacts a private live map without sending an SOS.</p>
                  <Button variant="safe" block className="mt-4" disabled={offline} onClick={() => setConfirming(true)}>
                    Share my location
                  </Button>
                </>
              )}
            </Card>
          )}

          {status && (
            <Card aria-labelledby="viewers-title">
              <CardTitle id="viewers-title">{active ? 'Who can see it' : 'Who would see it'}</CardTitle>
              {viewers.length ? (
                <ul className="grid gap-3">
                  {viewers.map((v, i) => (
                    <li key={`${v.name}-${i}`} className="flex items-center gap-3">
                      <Avatar name={v.name} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{v.name}</span>
                        {v.relationship && <span className="block text-sm text-soft">{v.relationship}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[15px] text-soft">
                  No emergency contacts yet. <Link to="/contacts" className="font-semibold text-ink underline">Add one</Link> so a share reaches someone.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmDialog title="Share your live location?" confirmLabel="Start sharing" busyLabel="Starting…" busy={busy} error={error} onConfirm={() => void start()} onCancel={() => setConfirming(false)}>
          <p>Your emergency contacts get a message with a private link to a live map. It ends when you tap “I’m safe”, or by itself after two hours.</p>
          {permission !== 'granted' && <p className="font-medium text-amber-ink">Location is off, so the map will have nothing to show until you allow it.</p>}
        </ConfirmDialog>
      )}
    </div>
  )
}
