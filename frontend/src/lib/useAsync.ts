import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => Promise<void>
  setData: (value: T | ((prev: T | undefined) => T)) => void
}

/** Load data on mount / when deps change; keeps previous data while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setDataState] = useState<T>()
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const result = await fnRef.current()
      if (id === seq.current) {
        setDataState(result)
        setError(null)
      }
    } catch (e) {
      if (id === seq.current) setError(e)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const setData = useCallback((value: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) =>
      typeof value === 'function' ? (value as (p: T | undefined) => T)(prev) : value,
    )
  }, [])

  return { data, error, loading, reload, setData }
}

/** Re-run callback periodically while condition holds and tab is visible. */
export function usePolling(cb: () => void, active: boolean, ms = 5000) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') ref.current()
    }, ms)
    return () => clearInterval(t)
  }, [active, ms])
}
