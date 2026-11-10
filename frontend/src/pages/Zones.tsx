import { LocateFixed, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { LocationTabs } from '../components/LocationTabs'
import { MapView } from '../components/MapView'
import { Button, IconButton } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { ConfirmDialog, Sheet } from '../components/ui/Dialog'
import { Switch, TextField } from '../components/ui/Field'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { SkeletonList } from '../components/ui/Spinner'
import { EmptyState, ErrorState, Notice } from '../components/ui/States'
import { StatusChip } from '../components/ui/StatusChip'
import { useSession } from '../contexts/SessionContext'
import { useToast } from '../contexts/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useGeolocation } from '../hooks/useGeolocation'
import { readLocationSilently, requestLocationPermission } from '../geolocation/device'
import { updateWatch } from '../geolocation/watcher'
import { api } from '../services/api'
import type { Zone, ZoneInput, ZoneKind, ZoneList } from '../types/api'

const PRESETS = ['Home', 'Workplace', 'College']

function describe(zone: Zone): string {
  const when = [zone.on_enter && 'on entry', zone.on_exit && 'on exit'].filter(Boolean).join(' and ')
  return `${zone.radius} m radius · ${when ? `alerts ${when}` : 'no alerts'}`
}

function ZoneForm({ initial, zones, onSaved, onClose }: { initial: Zone | null; zones: Zone[]; onSaved: (reply: ZoneList) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<ZoneKind>(initial?.kind ?? 'safe')
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(initial ? { lat: initial.lat, lng: initial.lng } : null)
  const [radius, setRadius] = useState(initial?.radius ?? 200)
  const [onEnter, setOnEnter] = useState(initial?.on_enter ?? false)
  const [onExit, setOnExit] = useState(initial?.on_exit ?? true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function chooseKind(next: ZoneKind) {
    setKind(next)
    // The usual meaning of each type. Either can still be changed below.
    setOnEnter(next === 'danger')
    setOnExit(next === 'safe')
  }

  async function useMyLocation() {
    setError('')
    setBusy(true)
    await requestLocationPermission()
    const here = await readLocationSilently()
    setBusy(false)
    if (here) setCentre({ lat: here.lat, lng: here.lng })
    else setError('Couldn’t get your location. Tap the map to choose the place instead.')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give this zone a name.')
    if (!centre) return setError('Tap the map to choose where this zone is.')
    setBusy(true)
    setError('')
    const input: ZoneInput = { name: name.trim(), kind, lat: centre.lat, lng: centre.lng, radius, enabled: initial?.enabled ?? true, on_enter: onEnter, on_exit: onExit }
    try {
      onSaved(initial ? await api.updateZone(initial.id, input) : await api.createZone(input))
    } catch {
      setError('Could not save this zone. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <Sheet title={initial ? 'Edit zone' : 'Add a zone'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <SegmentedControl
          label="Zone type"
          value={kind}
          onChange={chooseKind}
          tone={kind === 'safe' ? 'mint' : 'pink'}
          options={[
            { value: 'safe', label: 'Safe zone' },
            { value: 'danger', label: 'Danger zone' },
          ]}
        />
        <div className="grid gap-2">
          <TextField label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} hint="Only you see this." />
          {kind === 'safe' && (
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button key={preset} type="button" onClick={() => setName(preset)} className="min-h-10 rounded-full bg-fill px-4 text-sm font-semibold text-ink hover:bg-line">
                  {preset}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <MapView
            label="Map. Tap to choose the middle of the zone."
            zones={zones.filter((z) => z.id !== initial?.id)}
            preview={centre ? { ...centre, radius, kind } : null}
            onPick={(lat, lng) => setCentre({ lat, lng })}
            className="h-64"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-soft">{centre ? `Centre: ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}` : 'Tap the map to choose the middle of the zone.'}</p>
            <Button variant="secondary" size="sm" disabled={busy} icon={<LocateFixed size={16} aria-hidden="true" />} onClick={() => void useMyLocation()}>
              Use where I am
            </Button>
          </div>
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">Size: {radius} m around that point</span>
          <input type="range" min={50} max={2000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="h-11 w-full accent-green" />
        </label>

        <Switch label="Alert when I enter" hint="Your emergency contacts are told when you arrive here." checked={onEnter} onChange={setOnEnter} />
        <Switch label="Alert when I leave" hint="Your emergency contacts are told when you leave here." checked={onExit} onChange={setOnExit} />

        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button type="submit" loading={busy} className="flex-1">
            {busy ? 'Saving…' : 'Save zone'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

export function Zones() {
  const { offline } = useSession()
  const toast = useToast()
  const { position } = useGeolocation()
  const [editing, setEditing] = useState<Zone | 'new' | null>(null)
  const [removing, setRemoving] = useState<Zone | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const zones = useAsync(
    async () => {
      const reply = await api.zones()
      updateWatch(reply.watch, reply.watch_token)
      return reply.zones
    },
    [],
    !offline,
  )

  /** Every reply carries the list to show and the list to watch. Both are applied together. */
  function apply(reply: ZoneList) {
    zones.setData(reply.zones)
    updateWatch(reply.watch, reply.watch_token)
  }

  async function toggle(zone: Zone, enabled: boolean) {
    try {
      apply(await api.updateZone(zone.id, { ...zone, enabled }))
      toast(enabled ? `Watching ${zone.name}` : `Stopped watching ${zone.name}`)
    } catch {
      toast('Could not change that zone. Check your connection.', 'error')
    }
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    setRemoveError('')
    try {
      apply(await api.deleteZone(removing.id))
      setRemoving(null)
      toast('Zone removed')
    } catch {
      setRemoveError('Could not remove that zone. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const list = zones.data

  return (
    <div className="grid gap-4">
      <PageHeader title="Location" subtitle="Zones can alert your contacts by themselves when you arrive somewhere or leave it." />
      <LocationTabs />

      {offline ? (
        <Notice tone="warn">Zones can’t be shown or changed without a connection. Zones already set up are still watched while this app is open.</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
          <MapView label="Map of your safe and danger zones" zones={list ?? []} position={position} className="h-[38dvh] min-h-64 shadow-card lg:h-[70dvh]" />

          <div className="grid gap-3">
            <Notice>Zones are checked only while this app is open and the phone is awake, including on the calculator. A web app can’t watch zones in the background.</Notice>

            {zones.loading && !list && <SkeletonList rows={2} />}
            {zones.failed && <ErrorState onRetry={zones.reload}>Couldn’t load your zones.</ErrorState>}

            {list && list.length === 0 && (
              <EmptyState
                icon={<MapPinned size={28} />}
                title="No zones yet"
                action={
                  <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
                    Add a zone
                  </Button>
                }
              >
                Mark home, work or college as safe, or mark a place you want your contacts to know you’ve entered.
              </EmptyState>
            )}

            {list && list.length > 0 && (
              <>
                <ul className="grid gap-3">
                  {list.map((z) => (
                    <Card as="li" key={z.id} className="grid gap-3 p-4">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 font-semibold">
                            <span className="truncate">{z.name}</span>
                            <StatusChip tone={z.kind === 'safe' ? 'ok' : 'danger'}>{z.kind === 'safe' ? 'Safe zone' : 'Danger zone'}</StatusChip>
                          </p>
                          <p className="text-sm text-soft">{describe(z)}</p>
                        </div>
                        <IconButton label={`Edit ${z.name}`} onClick={() => setEditing(z)}>
                          <Pencil size={18} aria-hidden="true" />
                        </IconButton>
                        <IconButton label={`Remove ${z.name}`} onClick={() => setRemoving(z)}>
                          <Trash2 size={18} aria-hidden="true" />
                        </IconButton>
                      </div>
                      <Switch label={`Watch ${z.name}`} checked={z.enabled} onChange={(on) => void toggle(z, on)} />
                    </Card>
                  ))}
                </ul>
                <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
                  Add a zone
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {editing && (
        <ZoneForm
          initial={editing === 'new' ? null : editing}
          zones={list ?? []}
          onSaved={(reply) => {
            apply(reply)
            setEditing(null)
            toast('Zone saved')
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove zone" busyLabel="Removing…" danger busy={busy} error={removeError} onConfirm={() => void remove()} onCancel={() => setRemoving(null)}>
          <p>It will no longer be watched, and crossing it won’t alert anyone.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
