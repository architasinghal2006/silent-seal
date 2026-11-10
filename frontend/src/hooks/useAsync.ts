import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  /** True until the first load settles, and again during a reload that has nothing to show yet. */
  loading: boolean
  failed: boolean
  reload: () => void
  setData: (next: T | ((current: T | undefined) => T)) => void
}

/**
 * Loads something when the screen opens and whenever `deps` change. A reply that arrives
 * after the screen has moved on is ignored, so a slow request can't overwrite newer data.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList, enabled = true): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(enabled)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const loader = useRef(load)
  loader.current = load

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let current = true
    setLoading(true)
    setFailed(false)
    loader
      .current()
      .then((result) => {
        if (current) setData(result)
      })
      .catch(() => {
        if (current) setFailed(true)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { data, loading, failed, reload, setData }
}
