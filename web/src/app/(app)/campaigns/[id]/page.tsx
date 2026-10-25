'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { api } from '@/lib/api'
import { aboutMinutes, channelLabel, fmtDateTime, fmtNum, fmtTime, isActive, isFinished, maskPhone, statusLabel, titleCase } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import type { Campaign, CampaignReport, Failure, HeldBack } from '@/lib/types'
import { Button, Card, EmptyState, ErrorState, InlineError, LinkButton, Loading, StatTile, StatusBadge, Table, Td, Th } from '@/components/ui'

const HELD: Record<string, { label: (n: number) => string; why: string }> = {
  suppressed: { label: (n) => `${n === 1 ? 'was' : 'were'} suppressed`, why: 'replied STOP at some point' },
  optedOut: { label: (n) => `${n === 1 ? 'had' : 'had'} opted out`, why: 'replied STOP at some point' },
  noConsent: { label: (n) => `${n === 1 ? 'had' : 'had'} no consent`, why: 'imported without a source' },
  duplicates: { label: (n) => `${n === 1 ? 'was a duplicate' : 'were duplicates'}`, why: 'same number, two rows' },
  invalid: { label: (n) => `${n === 1 ? 'number was' : 'numbers were'} invalid`, why: 'carrier rejected the format' },
  alreadySent: { label: () => 'already had it', why: 'sent earlier in this campaign' },
  noPhone: { label: (n) => `${n === 1 ? 'has' : 'have'} no phone number`, why: 'nothing to send an SMS to' },
  noEmail: { label: (n) => `${n === 1 ? 'has' : 'have'} no email address`, why: 'nothing to send an email to' },
  overCap: { label: (n) => `${n === 1 ? 'is' : 'are'} waiting for tomorrow`, why: 'the daily cap was reached' },
  outsideWindow: { label: (n) => `${n === 1 ? 'is' : 'are'} waiting for sending hours`, why: 'outside the send window' },
}

/** "4 failed" is not information. Pair every carrier reason with a next step. */
function suggestFor(error: string | undefined): string {
  const e = (error ?? '').toLowerCase()
  if (!e) return 'retry tomorrow'
  if (/invalid|unknown (number|subscriber)|not a valid|format|absent subscriber|does not exist|unallocated/.test(e)) return 'fix the number'
  if (/no service|unreachable|out of (range|coverage)|timeout|temporar|busy|network/.test(e)) return 'retry tomorrow'
  if (/block|spam|reject|barred|denied|filter|blacklist/.test(e)) return 'try email instead'
  if (/opt|stop|unsubscribe|suppress/.test(e)) return 'do not contact again'
  if (/sim|credit|balance|airtime|no funds/.test(e)) return 'top up the SIM'
  if (/offline|phone|device|disconnected/.test(e)) return 'check the phone, then retry'
  if (/bounce|mailbox|smtp|relay|recipient address/.test(e)) return 'fix the email address'
  return 'retry tomorrow'
}

function toCsv(rows: Failure[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['who', 'number', 'email', 'what the carrier said', 'what to do', 'when']
  const lines = rows.map((f) => [f.name, f.phone, f.email, f.error, f.suggestion ?? suggestFor(f.error), f.failedAt].map(esc).join(','))
  return [head.join(','), ...lines].join('\n')
}

export default function CampaignReportPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const campaign = useLoad(() => api.get<Campaign>(`/campaigns/${id}`), [id], { every: 15000 })
  const report = useLoad(() => api.get<CampaignReport>(`/campaigns/${id}/report`).catch(() => null as CampaignReport | null), [id], { every: 15000 })
  const { busy, error, run } = useAction()

  const c = report.data?.campaign ?? campaign.data ?? null
  const stats = { ...(c?.stats ?? {}), ...(report.data?.stats ?? {}) }
  const held: HeldBack = report.data?.heldBack ?? {}
  const heldRows = useMemo(
    () =>
      Object.entries(held)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => ({ key: k, n: v as number, label: HELD[k]?.label(v as number) ?? titleCase(k).toLowerCase(), why: HELD[k]?.why ?? '' })),
    [held],
  )
  const picked = stats.picked ?? stats.eligible
  const sent = stats.sent
  const gap = picked !== undefined && sent !== undefined ? Math.max(0, picked - sent) : heldRows.reduce((a, b) => a + b.n, 0)
  const failures = report.data?.failures ?? []

  const act = async (verb: 'pause' | 'resume') => {
    await run(() => api.post(`/campaigns/${id}/${verb}`))
    campaign.reload()
    report.reload()
  }

  const download = () => {
    const blob = new Blob([toCsv(failures)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(c?.name ?? 'campaign').replace(/[^\w-]+/g, '_')}-failed.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (campaign.loading && !campaign.data && !report.data) return <Loading rows={5} />
  if (!c) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={campaign.error ?? 'This campaign could not be found. It may have been deleted.'} onRetry={campaign.reload} />
        <div className="text-center">
          <LinkButton href="/campaigns">All campaigns</LinkButton>
        </div>
      </div>
    )
  }

  const active = isActive(c.status)
  const target = stats.eligible ?? stats.picked ?? 0
  const remaining = target > (sent ?? 0) ? (target - (sent ?? 0)) / Math.max(1, c.ratePerMin ?? 10) : 0

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/campaigns" className="text-xs text-mut hover:underline">
            ← All campaigns
          </Link>
          <h1 className="mt-1 text-xl font-semibold md:text-2xl">{c.name || 'Untitled campaign'}</h1>
          <p className="mt-1 text-sm text-mut">
            {channelLabel(c.channel)} ·{' '}
            {isFinished(c.status) ? `finished ${c.finishedAt ? fmtTime(c.finishedAt) : ''}` : active ? (c.status === 'paused' ? 'paused' : `sending · ${aboutMinutes(remaining)} left`) : c.status === 'scheduled' ? `starts ${fmtDateTime(c.scheduledAt)}` : statusLabel(c.status).toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status} />
          {c.status === 'sending' && (
            <Button variant="danger" onClick={() => act('pause')} disabled={busy}>
              Pause
            </Button>
          )}
          {c.status === 'paused' && (
            <Button variant="primary" onClick={() => act('resume')} disabled={busy}>
              Resume
            </Button>
          )}
          {c.status === 'draft' && <LinkButton href={`/campaigns/new?draft=${c._id}`} variant="primary">Continue editing</LinkButton>}
        </div>
      </div>
      <InlineError message={error} />

      {c.status === 'draft' ? (
        <EmptyState title="This is still a draft" body="Nothing has been sent. Open it in the composer to finish and send." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatTile value={fmtNum(picked)} label="picked" hint="in the list when it started" />
            <StatTile value={fmtNum(sent)} label="actually sent" hint={picked !== undefined && sent !== undefined && picked !== sent ? `${fmtNum(gap)} held back, see below` : undefined} />
            <StatTile value={fmtNum(stats.delivered)} label="delivered" tone="ok" hint="the phone confirmed it" />
            <StatTile value={fmtNum(stats.failed)} label="failed" tone={stats.failed ? 'bad' : 'grey'} hint="carrier said no" />
            <StatTile value={fmtNum(stats.optedOut)} label="replied STOP" tone={stats.optedOut ? 'warn' : 'grey'} hint="now suppressed" />
            <StatTile value={fmtNum(stats.replied)} label="replied back" tone={stats.replied ? 'info' : 'grey'} href="/inbox" hint="open the inbox" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2" title={gap > 0 ? `Where the ${fmtNum(gap)} went — never a silent number` : 'Where everyone went'}>
              {report.loading && !report.data ? (
                <Loading rows={3} />
              ) : heldRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-mut">
                  {gap > 0
                    ? `${fmtNum(gap)} people in the list were not sent to, but the server has not said why yet.${active ? ' Numbers update while the campaign runs.' : ''}`
                    : 'Everyone picked was eligible and was sent to. Nobody was held back.'}
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {heldRows.map((h) => (
                    <li key={h.key} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                      <span>
                        <span className="font-semibold tabular-nums">{fmtNum(h.n)}</span> {h.label}
                      </span>
                      <span className="text-right text-xs text-mut">{h.why}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-line px-4 py-2 text-xs text-mut">Every number here is read from the actual send records, not recomputed from the list, so it reads the same next year.</div>
            </Card>

            <Card
              className="lg:col-span-3"
              title={failures.length > 0 ? `The ${fmtNum(failures.length)} that failed — with the reason, so you can act` : 'Failures'}
              action={
                failures.length > 0 ? (
                  <Button size="sm" onClick={download}>
                    Export this as CSV
                  </Button>
                ) : undefined
              }
            >
              {report.loading && !report.data ? (
                <Loading rows={3} />
              ) : failures.length === 0 ? (
                <div className="px-4 py-6 text-sm text-mut">
                  {stats.failed ? `${fmtNum(stats.failed)} failed, but the server has not sent the details yet.` : 'Nothing failed.'}
                </div>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Who</Th>
                      <Th>Number</Th>
                      <Th>What the carrier said</Th>
                      <Th>What to do</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.map((f, i) => (
                      <tr key={f.sendId ?? f.contactId ?? i}>
                        <Td className="font-medium">{f.name || 'Unknown'}</Td>
                        <Td mono>{f.phone ? maskPhone(f.phone) : f.email || '—'}</Td>
                        <Td className="text-bad">{f.error || 'no reason given'}</Td>
                        <Td className="whitespace-nowrap">{f.suggestion || suggestFor(f.error)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
          {report.error && <div className="mt-3 text-xs text-mut">Report details are unavailable right now: {report.error}</div>}
        </>
      )}
    </div>
  )
}
