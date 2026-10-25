'use client'

import Link from 'next/link'
import { useLoad } from '@/lib/hooks'
import { fetchPhoneStatus, phoneHeadline, type PhoneStatus } from '@/lib/status'
import { fmtNum, timeAgo } from '@/lib/format'

export function usePhoneStatus(every = 15000) {
  return useLoad<PhoneStatus>(() => fetchPhoneStatus(), [], { every })
}

/**
 * "Phone online · 112 of 500 sent today". The failure mode of the whole
 * system is a phone that quietly went offline, so this gets permanent
 * screen real estate on every page.
 */
export function PhoneStatusPill({ compact }: { compact?: boolean }) {
  const { data, loading } = usePhoneStatus()

  if (loading && !data) {
    return <span className="inline-flex h-8 w-44 animate-pulse rounded-full bg-greyb" aria-label="Checking the phone" />
  }
  if (!data) return null

  const tone =
    data.state === 'online' ? 'bg-okb text-ok' : data.state === 'unknown' ? 'bg-warnb text-warn' : 'bg-badb text-bad'
  const dot = data.state === 'online' ? 'bg-ok' : data.state === 'unknown' ? 'bg-warn' : 'bg-bad'

  const parts: string[] = [phoneHeadline(data)]
  if (data.sentToday !== null) {
    parts.push(data.dailyCap ? `${fmtNum(data.sentToday)} of ${fmtNum(data.dailyCap)} sent today` : `${fmtNum(data.sentToday)} sent today`)
  } else if (data.state === 'offline' && data.lastSeenAt) {
    parts.push(`last seen ${timeAgo(data.lastSeenAt)}`)
  }

  const text = compact ? parts[0] + (parts[1] ? ` · ${parts[1].replace(' sent today', '')}` : '') : parts.join(' · ')

  return (
    <Link
      href="/settings"
      title={data.lastSeenAt ? `Phone last seen ${timeAgo(data.lastSeenAt)}. Tap for details.` : 'Tap for phone details.'}
      className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${tone}`}
    >
      <span className={`h-2 w-2 flex-none rounded-full ${dot} ${data.state === 'online' ? 'animate-pulse' : ''}`} />
      <span className="truncate">{text}</span>
    </Link>
  )
}
