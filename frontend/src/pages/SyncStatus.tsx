import { Check, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card, CardTitle, PageHeader } from '../components/ui/Card'
import { Notice } from '../components/ui/States'
import { StatusChip, type Tone } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useAsync } from '../hooks/useAsync'
import { useOnline, useQueueStatus } from '../hooks/useOnline'
import { flushQueue, listQueue, subscribeQueue, type QueueItem, type SyncState } from '../offline/queue'
import { api } from '../services/api'
import { formatDateTime, parseServerTime, plural, timeAgo } from '../utils/format'
import { BackLink } from './Settings'

const TYPE_LABEL = { sos: 'Alert', unlock: 'Check-in', evidence: 'Evidence (encrypted)' }
const STATE: Record<SyncState, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'neutral' },
  syncing: { label: 'Sending', tone: 'ok' },
  failed: { label: 'Will retry', tone: 'warn' },
}

export function SyncStatus() {
  const { offline, demo } = useSession()
  const online = useOnline()
  const summary = useQueueStatus()
  const [items, setItems] = useState<QueueItem[]>([])
  const [syncing, setSyncing] = useState(false)
  const server = useAsync(() => api.offlineStatus(), [summary.waiting], !offline)

  useEffect(() => {
    let current = true
    const refresh = () =>
      void listQueue()
        .then((list) => {
          if (current) setItems(list)
        })
        .catch(() => undefined)
    refresh()
    const unsubscribe = subscribeQueue(refresh)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  async function syncNow() {
    setSyncing(true)
    await flushQueue({ force: true })
    setSyncing(false)
  }

  return (
    <div className="grid gap-4">
      <BackLink to="/settings">Settings</BackLink>
      <PageHeader title="Sync status" subtitle="Alerts and evidence made without a connection wait on this phone, then send once." />

      <Card aria-labelledby="queue-title" aria-live="polite">
        <CardTitle
          id="queue-title"
          action={<StatusChip tone={summary.waiting ? 'warn' : 'ok'} icon={summary.waiting ? undefined : <Check size={13} aria-hidden="true" />}>{summary.waiting ? 'Waiting to sync' : 'Up to date'}</StatusChip>}
        >
          On this phone
        </CardTitle>
        <p className="text-[15px] text-soft">
          {summary.waiting
            ? `${plural(summary.waiting, 'item')} waiting. Nothing here has been delivered yet: it is only marked sent after the server confirms it.`
            : 'Nothing is waiting to be sent.'}
          {summary.lastSyncedAt && ` Last sync ${timeAgo(new Date(summary.lastSyncedAt))}.`}
        </p>
        {!online && <p className="mt-2 text-sm font-medium text-amber-ink">No connection. Sending resumes by itself when it returns, while this app is open.</p>}
        <Button variant="secondary" className="mt-4" loading={syncing} disabled={!summary.waiting} icon={<RefreshCw size={17} aria-hidden="true" />} onClick={() => void syncNow()}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </Card>

      {demo && (
        <Card aria-labelledby="items-title">
          <CardTitle id="items-title" action={<StatusChip tone="simulated">Demo view</StatusChip>}>
            Queued items
          </CardTitle>
          {items.length === 0 ? (
            <p className="text-[15px] text-soft">The queue is empty. Go offline, send an alert or add evidence, and it will appear here until it syncs.</p>
          ) : (
            <ul className="grid">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{TYPE_LABEL[item.type]}</p>
                    <p className="text-sm text-soft">
                      <span className="font-mono">{item.id.slice(0, 8)}</span> · {formatDateTime(new Date(item.timestamp))}
                      {item.attempts > 0 && ` · ${plural(item.attempts, 'attempt')}, next ${timeAgo(new Date(item.nextAttemptAt)) === 'just now' ? 'now' : `at ${new Date(item.nextAttemptAt).toLocaleTimeString()}`}`}
                    </p>
                  </div>
                  <StatusChip tone={STATE[item.status].tone}>{STATE[item.status].label}</StatusChip>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-soft">This list is shown only on a demo server. Normally the app says only that something is waiting, never what.</p>
        </Card>
      )}

      {!offline && server.data && (
        <Card aria-labelledby="server-title">
          <CardTitle id="server-title">Confirmed by the server</CardTitle>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-control bg-bg p-4">
              <dt className="text-sm text-soft">Queued events applied</dt>
              <dd className="text-2xl font-bold tabular-nums">{server.data.applied}</dd>
            </div>
            <div className="rounded-control bg-bg p-4">
              <dt className="text-sm text-soft">Duplicates ignored</dt>
              <dd className="text-2xl font-bold tabular-nums">{server.data.duplicates}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-soft">
            {server.data.last_sync_at ? `Last received ${formatDateTime(parseServerTime(server.data.last_sync_at))}. ` : ''}
            If a reply is lost and the phone sends the same item again, the server recognises it and does nothing, so nobody is alerted twice.
          </p>
        </Card>
      )}

      {offline && <Notice tone="warn">You unlocked without a connection. Exit and unlock again once you’re online to see what the server has received.</Notice>}
    </div>
  )
}
