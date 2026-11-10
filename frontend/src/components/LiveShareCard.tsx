import { Radio } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../contexts/ToastContext'
import { api } from '../services/api'
import { stopStream } from '../services/liveStream'
import type { LiveShareStatus } from '../types/api'
import { formatTime, parseServerTime, plural } from '../utils/format'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { ConfirmDialog } from './ui/Dialog'
import { AvatarStack } from './ui/StatusChip'

/** Asks before ending a share, ends it on the server, and only then says it has ended. */
export function ImSafeButton({ onEnded, block }: { onEnded: () => void; block?: boolean }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await api.stopLiveShare()
      stopStream()
      setConfirming(false)
      toast('Sharing ended. Your contacts have been told you’re safe.')
      onEnded()
    } catch {
      setError('Could not end sharing, so your contacts can still see your location. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="safe" block={block} onClick={() => setConfirming(true)}>
        I’m safe
      </Button>
      {confirming && (
        <ConfirmDialog
          title="End location sharing?"
          confirmLabel="Yes, I’m safe"
          busyLabel="Ending…"
          cancelLabel="Keep sharing"
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        >
          <p>This stops your live map and tells your trusted contacts that you marked yourself safe.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

/** On the home screen while a share is running. A duress session is never told about the real share. */
export function LiveShareCard({ share, onEnded }: { share: LiveShareStatus; onEnded: () => void }) {
  if (!share.active) return null
  const names = share.viewers.map((v) => v.name)
  return (
    <Card tone="mint" aria-labelledby="live-share-title">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-green text-green-deep" aria-hidden="true">
          <Radio size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="live-share-title" className="font-semibold text-green-deep">
            Your location is being shared
          </h2>
          <p className="text-[15px] text-green-ink">
            {names.length ? `${plural(names.length, 'contact')} can see it` : 'No emergency contacts can see it yet'}
            {share.expires_at && ` until ${formatTime(parseServerTime(share.expires_at))}`}. Keep this app open so the map stays current.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {names.length > 0 && <AvatarStack names={names} />}
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to="/location" className="inline-flex min-h-12 items-center rounded-full bg-white px-5 text-[15px] font-semibold text-ink hover:bg-fill">
            View map
          </Link>
          <ImSafeButton onEnded={onEnded} />
        </div>
      </div>
    </Card>
  )
}
