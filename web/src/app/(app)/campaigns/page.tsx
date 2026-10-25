'use client'

import Link from 'next/link'
import { useState } from 'react'
import { api, qs } from '@/lib/api'
import { channelLabel, fmtDateTime, fmtNum, isActive, isFinished } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import type { Campaign } from '@/lib/types'
import { Button, Chip, Confirm, EmptyState, ErrorState, InlineError, LinkButton, Loading, PageHeader, Pager, StatusBadge, Table, Td, Th } from '@/components/ui'

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'all', label: 'all', match: () => true },
  { key: 'draft', label: 'drafts', match: (s) => s === 'draft' },
  { key: 'scheduled', label: 'scheduled', match: (s) => s === 'scheduled' },
  { key: 'sending', label: 'sending', match: (s) => isActive(s) },
  { key: 'done', label: 'done', match: (s) => isFinished(s) || s === 'failed' },
]

/** Rows move queued → sent → delivered, so "sent" means everything that left the phone. */
function sentCount(c: Campaign): number | undefined {
  if (!c.stats) return undefined
  return (c.stats.sent ?? 0) + (c.stats.delivered ?? 0)
}

export default function CampaignsPage() {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState<Campaign | null>(null)
  // GET /campaigns returns every campaign, newest first; filtering and paging happen here.
  const list = useLoad(() => api.list<Campaign>(`/campaigns${qs({ page, limit: 50 })}`), [page, filter], { every: 20000 })
  const { busy, error, run } = useAction()

  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
  const rows = (list.data?.data ?? []).filter((c) => f.match(c.status))

  const act = async (c: Campaign, verb: 'pause' | 'resume') => {
    await run(() => api.post(`/campaigns/${c._id}/${verb}`))
    list.reload()
  }
  const remove = async () => {
    if (!deleting) return
    const r = await run(() => api.del(`/campaigns/${deleting._id}`))
    if (r !== undefined) {
      setDeleting(null)
      list.reload()
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Campaigns"
        subtitle="Drafts, scheduled, sending, done. Open one to see exactly where every message went."
        actions={
          <LinkButton href="/campaigns/new" variant="primary">
            + New campaign
          </LinkButton>
        }
      />
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((x) => (
          <Chip
            key={x.key}
            active={filter === x.key}
            onClick={() => {
              setFilter(x.key)
              setPage(1)
            }}
          >
            {x.label}
          </Chip>
        ))}
      </div>
      <InlineError message={error} />
      <div className="mt-2 rounded-card border border-line bg-card">
        {list.loading && !list.data ? (
          <Loading rows={5} />
        ) : list.error && !list.data ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter === 'all' ? 'No campaigns yet' : `Nothing ${f.label} right now`}
            body={filter === 'all' ? 'Three steps: who gets it, what it says, when it goes. The composer shows you the real message and the real audience before you send.' : undefined}
            action={
              filter === 'all' ? (
                <LinkButton href="/campaigns/new" variant="primary">
                  + New campaign
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Campaign</Th>
                  <Th>Channel</Th>
                  <Th>Status</Th>
                  <Th right>Picked</Th>
                  <Th right>Sent</Th>
                  <Th right>Delivered</Th>
                  <Th right>Failed</Th>
                  <Th right>Held back</Th>
                  <Th>When</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c._id} className="hover:bg-greyb/50">
                    <Td className="font-medium">
                      <Link href={c.status === 'draft' ? `/campaigns/new?draft=${c._id}` : `/campaigns/${c._id}`} className="hover:underline">
                        {c.name || 'Untitled campaign'}
                      </Link>
                    </Td>
                    <Td>{channelLabel(c.channel)}</Td>
                    <Td>
                      <StatusBadge status={c.status} error={c.error} />
                    </Td>
                    <Td right>{fmtNum(c.stats?.picked)}</Td>
                    <Td right>{fmtNum(sentCount(c))}</Td>
                    <Td right className="text-ok">{fmtNum(c.stats?.delivered)}</Td>
                    <Td right className={c.stats?.failed ? 'text-bad' : ''}>{fmtNum(c.stats?.failed)}</Td>
                    <Td right>{fmtNum(c.stats?.skipped)}</Td>
                    <Td className="whitespace-nowrap text-mut">
                      {(c.status === 'scheduled' || c.status === 'draft') && c.scheduledAt ? `${c.status === 'draft' ? 'planned for' : 'starts'} ${fmtDateTime(c.scheduledAt)}` : c.completedAt ? `finished ${fmtDateTime(c.completedAt)}` : c.startedAt ? `started ${fmtDateTime(c.startedAt)}` : c.createdAt ? `created ${fmtDateTime(c.createdAt)}` : '—'}
                    </Td>
                    <Td right>
                      <span className="flex justify-end gap-1">
                        {c.status === 'sending' && (
                          <Button variant="danger" size="sm" onClick={() => act(c, 'pause')} disabled={busy}>
                            Pause
                          </Button>
                        )}
                        {c.status === 'paused' && (
                          <Button variant="primary" size="sm" onClick={() => act(c, 'resume')} disabled={busy}>
                            Resume
                          </Button>
                        )}
                        {(c.status === 'draft' || c.status === 'scheduled') && (
                          <Button variant="ghost" size="sm" className="text-bad" onClick={() => setDeleting(c)}>
                            Delete
                          </Button>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} totalPages={list.data?.meta?.totalPages} total={list.data?.meta?.total} noun="campaigns" onPage={setPage} />
          </>
        )}
      </div>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={deleting?.status === 'scheduled' ? 'Cancel and delete this scheduled campaign?' : 'Delete this draft?'}
        body={<p>“{deleting?.name || 'Untitled campaign'}” will be removed. Nothing has been sent from it.</p>}
        confirmLabel="Delete"
        danger
        busy={busy}
      />
    </div>
  )
}
