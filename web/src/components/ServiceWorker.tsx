'use client'

import { useEffect } from 'react'

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline install is a convenience, never a requirement.
    })
  }, [])
  return null
}
