import { useEffect, useState } from 'react'
import { queueSummary, subscribeQueue, type QueueSummary } from '../offline/queue'

/** Whether the browser believes it has a connection. It can be wrong, so requests still handle failure. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

const EMPTY: QueueSummary = { waiting: 0, retrying: 0, lastSyncedAt: null }

/** How much is waiting on this phone to be sent. Updates as items are queued and confirmed. */
export function useQueueStatus(): QueueSummary {
  const [summary, setSummary] = useState<QueueSummary>(EMPTY)
  useEffect(() => {
    let current = true
    const refresh = () =>
      void queueSummary().then((next) => {
        if (current) setSummary(next)
      })
    refresh()
    const unsubscribe = subscribeQueue(refresh)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return summary
}
