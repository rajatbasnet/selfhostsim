'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { api } from '@/lib/api'
import { aboutMinutes, channelLabel, fmtDateTime, fmtNum, fmtTime, isActive, isCancelled, isFinished, maskPhone, SKIP_REASONS, statusLabel, titleCase } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import type { Campaign, CampaignReport, CampaignStats, ReportFailure } from '@/lib/types'
import { Button, Card, EmptyState, ErrorState, InlineError, LinkButton, Loading, StatTile, StatusBadge, Table, Td, Th } from '@/components/ui'

/** A failure row as the table shows it, derived from the API's { contact, recipient, errorCode, errorMessage }. */
interface FailureRow {
  key: string
  name: string
  phone?: string
  email?: string
  error: string
  suggestion: string
  attempts?: number
  failedAt?: string
}

/** "4 failed" is not information. Pair every carrier reason with a next step. */
function suggestFor(code: string | undefined, message: string | undefined): string {
  const e = `${code ?? ''} ${message ?? ''}`.trim().toLowerCase()
  if (!e) return 'retry tomorrow'
  if (/campaign_cancelled|cancelled before dispatch/.test(e)) return 'nothing — you cancelled it'
  if (/invalid|unknown (number|subscriber)|not a valid|format|absent subscriber|does not exist|unallocated/.test(e)) return 'fix the number'
  if (/no service|unreachable|out of (range|coverage)|timeout|temporar|busy|network/.test(e)) return 'retry tomorrow'
  if (/block|spam|reject|barred|denied|filter|blacklist/.test(e)) return 'try email instead'
  if (/opt|stop|unsubscribe|suppress/.test(e)) return 'do not contact again'
  if (/sim|credit|balance|airtime|no funds/.test(e)) return 'top up the SIM'
  if (/offline|phone|device|disconnected/.test(e)) return 'check the phone, then retry'
  if (/bounce|mailbox|smtp|relay|recipient address/.test(e)) return 'fix the email address'
  return 'retry tomorrow'
}

function toRow(f: ReportFailure, i: number): FailureRow {
  const recipient = f.recipient ?? ''
  const isEmail = recipient.includes('@')
  const error = f.errorMessage || f.errorCode || ''
  return {
    key: f.sendId ?? `${f.contact?.id ?? 'x'}-${i}`,
    name: f.contact?.name?.trim() || '',
    phone: isEmail ? undefined : recipient || undefined,
    email: isEmail ? recipient : undefined,
    error,
    suggestion: suggestFor(f.errorCode, f.errorMessage),
    attempts: f.attempts,
    failedAt: f.failedAt,
  }
}

function toCsv(rows: FailureRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['who', 'number', 'email', 'what the carrier said', 'what to do', 'when']
  const lines = rows.map((f) => [f.name, f.phone, f.email, f.error, f.suggestion, f.failedAt].map(esc).join(','))
  return [head.join(','), ...lines].join('\n')
}

export default function CampaignReportPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const campaign = useLoad(() => api.get<Campaign>(`/campaigns/${id}`), [id], { every: 15000 })
  const report = useLoad(() => api.get<CampaignReport>(`/campaigns/${id}/report`).catch(() => null as CampaignReport | null), [id], { every: 15000 })
  const { busy, error, run } = useAction()

  // GET /campaigns/:id is the full document; the report carries a summary with `id` instead of `_id`.
  const rc = report.data?.campaign
  const c: Campaign | null = campaign.data ?? (rc ? { _id: rc.id, name: rc.name, channel: rc.channel, status: rc.status, startedAt: rc.startedAt, completedAt: rc.completedAt, error: rc.error, stats: rc.stats } : null)
  const stats: CampaignStats = rc?.stats ?? c?.stats ?? {}
  const totals = report.data?.totals
  // Send rows move queued → sent → delivered | failed. Prefer the report's live counts, then the cached stats.
  const picked = stats.picked ?? totals?.total
  const delivered = totals?.delivered ?? stats.delivered
  const failed = totals?.failed ?? stats.failed
  const inFlight = totals?.sent ?? stats.sent
  const queued = totals?.queued ?? stats.queued
  const sent = inFlight !== undefined || delivered !== undefined ? (inFlight ?? 0) + (delivered ?? 0) : undefined
  const skippedByReason = report.data?.skippedByReason ?? stats.skippedByReason ?? {}
  const heldRows = useMemo(
    () =>
      Object.entries(skippedByReason)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => ({ key: k, n: v, label: v === 1 ? SKIP_REASONS[k]?.one ?? titleCase(k).toLowerCase() : SKIP_REASONS[k]?.many ?? titleCase(k).toLowerCase(), why: SKIP_REASONS[k]?.why ?? '' })),
    [skippedByReason],
  )
  const gap = totals?.skipped ?? stats.skipped ?? heldRows.reduce((a, b) => a + b.n, 0)
  const failures = useMemo(() => (report.data?.failures ?? []).map(toRow), [report.data])

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
  const rate = c.pacing?.ratePerMinute ?? 10
  const remaining = (queued ?? 0) / Math.max(1, rate)
  const cancelled = isCancelled(c)

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
            {isFinished(c.status)
              ? `finished ${c.completedAt ? fmtTime(c.completedAt) : ''}`
              : active
                ? c.status === 'paused'
                  ? 'paused'
                  : `sending · ${aboutMinutes(remaining)} left`
                : c.status === 'scheduled'
                  ? `starts ${fmtDateTime(c.scheduledAt)}`
                  : c.status === 'failed' && c.error && !cancelled
                    ? `stopped: ${c.error}`
                    : statusLabel(c.status, c.error).toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status} error={c.error} />
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
        <EmptyState
          title="This is still a draft"
          body={c.scheduledAt ? `Planned for ${fmtDateTime(c.scheduledAt)}. The server does not start campaigns on a timer yet, so open it in the composer and press Send when the time comes.` : 'Nothing has been sent. Open it in the composer to finish and send.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatTile value={fmtNum(picked)} label="picked" hint="in the list when it started" />
            <StatTile value={fmtNum(sent)} label="actually sent" hint={gap > 0 ? `${fmtNum(gap)} held back, see below` : undefined} />
            <StatTile value={fmtNum(delivered)} label="delivered" tone="ok" hint="the phone confirmed it" />
            <StatTile value={fmtNum(failed)} label="failed" tone={failed ? 'bad' : 'grey'} hint="carrier said no" />
            <StatTile value={fmtNum(queued)} label="still to go" tone={queued ? 'info' : 'grey'} hint={active ? `at ${rate} a minute` : 'queued'} />
            <StatTile value={fmtNum(gap)} label="held back" tone={gap ? 'warn' : 'grey'} hint="never sent, see below" />
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
                  {failed ? `${fmtNum(failed)} failed, but the server has not sent the details yet.` : 'Nothing failed.'}
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
                    {failures.map((f) => (
                      <tr key={f.key}>
                        <Td className="font-medium">{f.name || 'Unknown'}</Td>
                        <Td mono>{f.phone ? maskPhone(f.phone) : f.email || '—'}</Td>
                        <Td className="text-bad">
                          {f.error || 'no reason given'}
                          {f.attempts && f.attempts > 1 ? <span className="block text-xs text-mut">after {f.attempts} tries</span> : null}
                        </Td>
                        <Td className="whitespace-nowrap">{f.suggestion}</Td>
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
