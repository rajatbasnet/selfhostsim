'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { api } from '@/lib/api'
import { channelLabel, fmtDateTime, fmtNum, isFinished } from '@/lib/format'
import { useLoad } from '@/lib/hooks'
import type { Campaign } from '@/lib/types'
import { EmptyState, ErrorState, LinkButton, Loading, PageHeader, StatTile, StatusBadge, Table, Td, Th } from '@/components/ui'

export default function ReportsPage() {
  const list = useLoad(() => api.list<Campaign>('/campaigns'), [])
  // Send rows move queued → sent → delivered, so "sent" is both of those.
  const sentOf = (c: Campaign) => (c.stats?.sent ?? 0) + (c.stats?.delivered ?? 0)
  const finished = useMemo(() => (list.data?.data ?? []).filter((c) => isFinished(c.status) || c.status === 'failed' || sentOf(c) > 0), [list.data])

  const totals = useMemo(() => {
    const t = { sent: 0, delivered: 0, failed: 0, skipped: 0 }
    for (const c of finished) {
      t.sent += sentOf(c)
      t.delivered += c.stats?.delivered ?? 0
      t.failed += c.stats?.failed ?? 0
      t.skipped += c.stats?.skipped ?? 0
    }
    return t
  }, [finished])

  const rate = totals.sent > 0 ? Math.round((totals.delivered / totals.sent) * 100) : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle="Per campaign: delivered, failed, opted out, and who to call back. Open one to see where every single message went." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile value={fmtNum(totals.sent)} label="messages sent, all campaigns" />
        <StatTile value={rate === null ? '—' : `${rate}%`} label="delivered" tone="ok" hint={rate === null ? 'nothing sent yet' : `${fmtNum(totals.delivered)} confirmed by the phone`} />
        <StatTile value={fmtNum(totals.failed)} label="failed" tone={totals.failed ? 'bad' : 'grey'} />
        <StatTile value={fmtNum(totals.skipped)} label="held back" tone={totals.skipped ? 'warn' : 'grey'} hint="opted out, no consent, duplicates" />
      </div>
      <div className="mt-4 rounded-card border border-line bg-card">
        {list.loading && !list.data ? (
          <Loading rows={5} />
        ) : list.error && !list.data ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : finished.length === 0 ? (
          <EmptyState title="No finished campaigns yet" body="Once a campaign has sent, its report appears here with every delivered, failed and opted-out message explained." action={<LinkButton href="/campaigns/new" variant="primary">+ New campaign</LinkButton>} />
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
                <Th>Finished</Th>
              </tr>
            </thead>
            <tbody>
              {finished.map((c) => (
                <tr key={c._id} className="hover:bg-greyb/50">
                  <Td className="font-medium">
                    <Link href={`/campaigns/${c._id}`} className="hover:underline">
                      {c.name || 'Untitled campaign'}
                    </Link>
                  </Td>
                  <Td>{channelLabel(c.channel)}</Td>
                  <Td>
                    <StatusBadge status={c.status} error={c.error} />
                  </Td>
                  <Td right>{fmtNum(c.stats ? sentOf(c) : undefined)}</Td>
                  <Td right className="text-ok">{fmtNum(c.stats?.delivered)}</Td>
                  <Td right className={c.stats?.failed ? 'text-bad' : ''}>{fmtNum(c.stats?.failed)}</Td>
                  <Td right>{fmtNum(c.stats?.skipped)}</Td>
                  <Td className="whitespace-nowrap text-mut">{fmtDateTime(c.completedAt ?? c.startedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  )
}
