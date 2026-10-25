import { api } from './api'
import type { Device, GatewayStats } from './types'

export type PhoneState = 'online' | 'offline' | 'unknown' | 'none'

export interface PhoneStatus {
  state: PhoneState
  device: Device | null
  devices: Device[]
  stats: GatewayStats | null
  sentToday: number | null
  dailyCap: number | null
  lastSeenAt: string | null
  /** True when the API itself could not be reached. */
  apiDown: boolean
}

export const ONLINE_WINDOW_MS = 2 * 60 * 1000

export function deviceState(d: Device | null | undefined, nowMs = Date.now()): PhoneState {
  if (!d) return 'none'
  if (d.enabled === false) return 'offline'
  const seen = d.lastSeenAt ?? d.updatedAt ?? null
  if (!seen) return 'unknown'
  const t = new Date(seen).getTime()
  if (Number.isNaN(t)) return 'unknown'
  return nowMs - t < ONLINE_WINDOW_MS ? 'online' : 'offline'
}

export async function fetchPhoneStatus(): Promise<PhoneStatus> {
  const [devRes, statsRes] = await Promise.allSettled([
    api.list<Device>('/gateway/devices'),
    api.get<GatewayStats>('/gateway/stats'),
  ])
  const apiDown = devRes.status === 'rejected' && statsRes.status === 'rejected'
  const devices = devRes.status === 'fulfilled' ? devRes.value.data : []
  const stats = statsRes.status === 'fulfilled' ? statsRes.value ?? null : null
  // Prefer the most recently seen enabled device.
  const sorted = [...devices].sort((a, b) => {
    const ta = new Date(a.lastSeenAt ?? a.updatedAt ?? 0).getTime() || 0
    const tb = new Date(b.lastSeenAt ?? b.updatedAt ?? 0).getTime() || 0
    return tb - ta
  })
  const device = sorted.find((d) => d.enabled !== false) ?? sorted[0] ?? null
  return {
    state: apiDown ? 'unknown' : deviceState(device),
    device,
    devices,
    stats,
    sentToday: stats?.sentToday ?? null,
    dailyCap: stats?.dailyCap ?? null,
    lastSeenAt: device?.lastSeenAt ?? device?.updatedAt ?? null,
    apiDown,
  }
}

export function phoneHeadline(s: PhoneStatus): string {
  if (s.apiDown) return 'Server unreachable'
  switch (s.state) {
    case 'online':
      return 'Phone online'
    case 'offline':
      return 'Phone offline'
    case 'none':
      return 'No phone connected'
    default:
      return 'Phone status unknown'
  }
}
