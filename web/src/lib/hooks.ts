'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from './api'

export interface Loadable<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Fetch once (and again when `deps` change). Never throws into the UI. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { every?: number } = {}): Loadable<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let alive = true
    setLoading(true)
    fnRef
      .current()
      .then((d) => {
        if (!alive) return
        setData(d)
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setError(describeError(e))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  useEffect(() => {
    if (!opts.every) return
    const id = window.setInterval(() => setTick((t) => t + 1), opts.every)
    return () => window.clearInterval(id)
  }, [opts.every])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Debounce a changing value. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

/** A tiny async action helper: busy flag + last error, no throwing. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(describeError(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, run, clearError: () => setError(null) }
}
