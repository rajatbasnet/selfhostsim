'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { api } from '@/lib/api'
import { useAction, useLoad } from '@/lib/hooks'
import { aboutMinutes, channelLabel, fmtNum, isActive, timeAgo } from '@/lib/format'
import type { Campaign } from '@/lib/types'
import { usePhoneStatus } from '@/components/PhoneStatusPill'
import { Button, Card, EmptyState, ErrorState, InlineError, LinkButton, Loading, StatTile, StatusBadge, Table, Td, Th } from '@/components/ui'

function greeting(): string {
  const h = new Date().getHours()
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long' })
  if (h < 12) return `${day} morning`
  if (h < 17) return `${day} afternoon`
  return `${day} evening`
}

export default function DashboardPage() {
  const phone = usePhoneStatus(15000)
  const campaigns = useLoad(() => api.list<Campaign>('/campaigns'), [], { every: 20000 })
  const { busy, error: actionError, run } = useAction()

  const active = useMemo(() => campaigns.data?.data.find((c) => isActive(c.status)) ?? null, [campaigns.data])
  const stats = phone.data?.stats ?? null
  const dev = phone.data?.device ?? null

  const pauseResume = async (c: Campaign) => {
    const verb = c.status === 'paused' ? 'resume' : 'pause'
    await run(() => api.post(`/campaigns/${c._id}/${verb}`))
    campaigns.reload()
  }

  // Progress for the "sending now" panel. Rows move queued → sent → delivered | failed;
  // the target is everyone picked who was not held back.
  const sent = (active?.stats?.sent ?? 0) + (active?.stats?.delivered ?? 0) + (active?.stats?.failed ?? 0)
  const target = Math.max(0, (active?.stats?.picked ?? 0) - (active?.stats?.skipped ?? 0))
  const rate = active?.pacing?.ratePerMinute ?? 10
  const remaining = target > sent ? (target - sent) / Math.max(rate, 1) : 0
  const pct = target > 0 ? Math.min(100, Math.round((sent / target) * 100)) : 0

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">{greeting()}</h1>
          <p className="mt-1 text-sm text-mut">Is the phone alive, how much went out today, what is running, did anything break.</p>
        </div>
        <LinkButton href="/campaigns/new" variant="primary">
          + New campaign
        </LinkButton>
      </div>

      {phone.data?.apiDown && <ErrorState compact message="The Sendline server is not answering. The numbers below may be stale." onRetry={phone.reload} />}

      {/* Four tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile value={fmtNum(stats?.sentToday)} label="sent today" hint={stats?.dailyCap ? `of a ${fmtNum(stats.dailyCap)} daily cap` : stats?.sentToday === undefined ? 'not reported yet' : undefined} />
        <StatTile value={fmtNum(stats?.deliveredToday)} label="delivered today" tone="ok" hint={stats?.deliveredToday === undefined ? 'not reported yet' : undefined} />
        <StatTile value={fmtNum(stats?.failedToday)} label="failed today" tone={stats?.failedToday ? 'bad' : 'grey'} hint={stats?.failedToday === undefined ? 'not reported yet' : undefined} />
        <StatTile value={fmtNum(stats?.newReplies)} label="new replies" tone={stats?.newReplies ? 'info' : 'grey'} href="/inbox" hint={stats?.newReplies === undefined ? 'open the inbox' : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Sending now */}
        <Card className="lg:col-span-2" title={active ? `Sending now · ${active.name}` : 'Sending now'}>
          {campaigns.loading && !campaigns.data ? (
            <Loading rows={2} />
          ) : campaigns.error && !campaigns.data ? (
            <ErrorState compact message={campaigns.error} onRetry={campaigns.reload} />
          ) : !active ? (
            <EmptyState
              title="Nothing is sending right now"
              body="When a campaign is running you will see its progress here, with a Pause button that stops it within a few seconds."
              action={<LinkButton href="/campaigns/new">Start a campaign</LinkButton>}
            />
          ) : (
            <div className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-lg font-semibold tabular-nums">
                  {fmtNum(sent)} of {fmtNum(target)} <span className="text-sm font-normal text-mut">{channelLabel(active.channel)} messages sent</span>
                </div>
                <StatusBadge status={active.status} error={active.error} />
              </div>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-greyb" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full ${active.status === 'paused' ? 'bg-warn' : 'bg-info'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 text-sm text-mut">
                {active.status === 'paused'
                  ? 'Paused. Nothing goes out until you press Resume.'
                  : target > sent
                    ? `${aboutMinutes(remaining)} left at ${rate} a minute`
                    : 'Waiting for the phone to confirm the last few.'}
                {active.stats?.failed ? ` · ${fmtNum(active.stats.failed)} failed so far` : ''}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant={active.status === 'paused' ? 'primary' : 'danger'} onClick={() => pauseResume(active)} disabled={busy}>
                  {busy ? 'Working…' : active.status === 'paused' ? 'Resume sending' : 'Pause'}
                </Button>
                <LinkButton href={`/campaigns/${active._id}`}>Open</LinkButton>
              </div>
              <div className="mt-2">
                <InlineError message={actionError} />
              </div>
            </div>
          )}
        </Card>

        {/* The phone */}
        <Card title="The phone" action={<Link href="/settings" className="text-xs text-link underline">Details</Link>}>
          {phone.loading && !phone.data ? (
            <Loading rows={4} />
          ) : !dev ? (
            <EmptyState title="No phone connected yet" body="Install the Sendline app on an Android phone and sign in with your account. It will show up here." />
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 p-4 text-sm">
              <dt className="text-mut">last seen</dt>
              <dd className={phone.data?.state === 'online' ? 'text-ok' : phone.data?.state === 'offline' ? 'text-bad' : ''}>
                {phone.data?.lastSeenAt ? timeAgo(phone.data.lastSeenAt) : 'not reported'}
              </dd>
              <dt className="text-mut">battery</dt>
              <dd>
                {dev.batteryLevel !== undefined && dev.batteryLevel !== null ? `${dev.batteryLevel}%` : 'not reported'}
                {dev.isCharging ? ' · charging' : ''}
              </dd>
              <dt className="text-mut">signal</dt>
              <dd>{dev.signal ?? 'not reported'}</dd>
              <dt className="text-mut">SIM</dt>
              <dd>{dev.simLabel ?? 'not named yet'}</dd>
              <dt className="text-mut">phone</dt>
              <dd className="truncate">{[dev.brand ?? dev.manufacturer, dev.model].filter(Boolean).join(' ') || 'unknown model'}</dd>
              <dt className="text-mut">sent all time</dt>
              <dd className="tabular-nums">{fmtNum(dev.sentSMSCount)} texts</dd>
            </dl>
          )}
          {phone.data?.state === 'offline' && (
            <div className="border-t border-line px-4 py-3 text-xs text-bad">Nothing can send while the phone is offline. Check it is on, unlocked once, and connected to the internet.</div>
          )}
        </Card>
      </div>

      {/* Recent campaigns */}
      <Card className="mt-4" title="Recent" action={<Link href="/campaigns" className="text-xs text-link underline">All campaigns</Link>}>
        {campaigns.loading && !campaigns.data ? (
          <Loading />
        ) : campaigns.error && !campaigns.data ? (
          <ErrorState compact message={campaigns.error} onRetry={campaigns.reload} />
        ) : !campaigns.data || campaigns.data.data.length === 0 ? (
          <EmptyState title="No campaigns yet" body="Your first one takes about a minute: pick who, write what, choose when." action={<LinkButton href="/campaigns/new" variant="primary">+ New campaign</LinkButton>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th right>Sent</Th>
                <Th right>Delivered</Th>
                <Th right>Failed</Th>
                <Th right>Held back</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.data.data.slice(0, 6).map((c) => (
                <tr key={c._id} className="hover:bg-greyb/50">
                  <Td>
                    <Link href={`/campaigns/${c._id}`} className="font-medium hover:underline">
                      {c.name || 'Untitled campaign'}
                    </Link>
                  </Td>
                  <Td>{channelLabel(c.channel)}</Td>
                  <Td>
                    <StatusBadge status={c.status} error={c.error} />
                  </Td>
                  <Td right>{fmtNum(c.stats ? (c.stats.sent ?? 0) + (c.stats.delivered ?? 0) : undefined)}</Td>
                  <Td right className="text-ok">{fmtNum(c.stats?.delivered)}</Td>
                  <Td right className={c.stats?.failed ? 'text-bad' : ''}>{fmtNum(c.stats?.failed)}</Td>
                  <Td right>{fmtNum(c.stats?.skipped)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
