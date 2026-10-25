'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, qs } from '@/lib/api'
import { fmtNum, maskPhone, timeAgo } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { countSms } from '@/lib/sms'
import type { Device, InboxMessage } from '@/lib/types'
import { SmsCounter } from '@/components/SmsCounter'
import { Badge, Button, Confirm, EmptyState, ErrorState, InlineError, Loading, Modal, Notice, PageHeader, Pager, Textarea } from '@/components/ui'

interface ReceivedSms {
  _id: string
  sender?: string
  message?: string
  receivedAt?: string
  createdAt?: string
  device?: Device
}

const STOP_WORDS = /^\s*(stop|unsubscribe|quit|end|cancel)\b/i

function normalise(m: InboxMessage): Required<Pick<InboxMessage, '_id'>> & { from: string; name: string; body: string; at: string | undefined; isStop: boolean; contactId?: string; campaignName?: string } {
  const from = m.phone ?? m.from ?? m.sender ?? ''
  const body = m.body ?? m.message ?? ''
  return {
    _id: m._id,
    from,
    name: m.contactName || maskPhone(from),
    body,
    at: m.receivedAt ?? m.createdAt,
    isStop: m.isStop ?? STOP_WORDS.test(body),
    contactId: m.contactId,
    campaignName: m.campaignName,
  }
}

/** Try the Sendline inbox first; fall back to the raw gateway received-SMS list. */
async function loadInbox(page: number): Promise<{ items: InboxMessage[]; total?: number; totalPages?: number; source: 'inbox' | 'gateway'; deviceId?: string }> {
  try {
    const r = await api.list<InboxMessage>(`/inbox${qs({ page, limit: 50, sort: '-receivedAt' })}`)
    return { items: r.data, total: r.meta?.total, totalPages: r.meta?.totalPages, source: 'inbox' }
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 0)) throw e
    if (e.status === 0) throw e
  }
  const devices = await api.list<Device>('/gateway/devices')
  const dev = devices.data[0]
  if (!dev) return { items: [], source: 'gateway' }
  const r = await api.list<ReceivedSms>(`/gateway/devices/${dev._id}/get-received-sms${qs({ page, limit: 50 })}`)
  return {
    items: r.data.map((s) => ({ _id: s._id, sender: s.sender, message: s.message, receivedAt: s.receivedAt ?? s.createdAt })),
    total: r.meta?.total,
    totalPages: r.meta?.totalPages,
    source: 'gateway',
    deviceId: dev._id,
  }
}

export default function InboxPage() {
  const [page, setPage] = useState(1)
  const inbox = useLoad(() => loadInbox(page), [page], { every: 15000 })
  const [replyTo, setReplyTo] = useState<ReturnType<typeof normalise> | null>(null)
  const [suppressing, setSuppressing] = useState<ReturnType<typeof normalise> | null>(null)
  const { busy, error, run } = useAction()

  const rows = useMemo(() => {
    const list = (inbox.data?.items ?? []).map(normalise)
    return list.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
  }, [inbox.data])

  const suppress = async () => {
    if (!suppressing) return
    const r = await run(() => api.post('/suppression', { phone: suppressing.from, reason: 'manual' }))
    if (r !== undefined) {
      setSuppressing(null)
      inbox.reload()
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Inbox" subtitle="Replies, newest first. One tap to reply or to make sure they are never messaged again." />
      <InlineError message={error} />
      <div className="mt-2 rounded-card border border-line bg-card">
        {inbox.loading && !inbox.data ? (
          <Loading rows={5} />
        ) : inbox.error && !inbox.data ? (
          <ErrorState message={inbox.error} onRetry={inbox.reload} />
        ) : rows.length === 0 ? (
          <EmptyState title="No replies yet" body="When someone texts back, it shows up here within seconds. STOP replies are handled automatically and shown so you know." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {rows.map((m) => (
                <li key={m._id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      {m.name !== maskPhone(m.from) && <span className="text-xs text-mut">{maskPhone(m.from)}</span>}
                      {m.isStop && <Badge tone="bad" title="This person asked to stop. They are suppressed automatically.">STOP</Badge>}
                      {m.campaignName && <span className="text-xs text-mut">re: {m.campaignName}</span>}
                      <span className="ml-auto text-xs text-mut">{timeAgo(m.at)}</span>
                    </div>
                    <div className={`bubble mt-1 text-sm ${m.isStop ? 'opacity-70' : ''}`}>{m.body || <span className="text-mut">(empty message)</span>}</div>
                  </div>
                  <div className="flex flex-none gap-2 sm:pt-6">
                    <Button size="sm" variant="primary" onClick={() => setReplyTo(m)} disabled={m.isStop || !m.from} title={m.isStop ? 'They asked you to stop, so you cannot reply from here.' : undefined}>
                      Reply
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setSuppressing(m)} disabled={m.isStop || !m.from}>
                      Suppress
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={page} totalPages={inbox.data?.totalPages} total={inbox.data?.total} noun="replies" onPage={setPage} />
          </>
        )}
      </div>
      {inbox.data?.source === 'gateway' && <p className="mt-2 text-xs text-mut">Showing raw texts received by the phone.</p>}

      <ReplyModal target={replyTo} deviceId={inbox.data?.deviceId} onClose={() => setReplyTo(null)} onSent={inbox.reload} />
      <Confirm
        open={Boolean(suppressing)}
        onClose={() => setSuppressing(null)}
        onConfirm={suppress}
        busy={busy}
        danger
        title={`Never message ${suppressing?.name ?? 'this person'} again?`}
        confirmLabel="Yes, suppress"
        body={
          <>
            <p>
              {maskPhone(suppressing?.from)} goes on the do-not-contact list. No campaign can include them, and a future CSV import cannot bring them back. They stay visible in Contacts so you can see their history.
            </p>
          </>
        }
      />
    </div>
  )
}

function ReplyModal({ target, deviceId, onClose, onSent }: { target: ReturnType<typeof normalise> | null; deviceId?: string; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, run, clearError } = useAction()
  const open = Boolean(target)

  useEffect(() => {
    if (open) {
      setText('')
      setDone(false)
      clearError()
    }
  }, [open, target, clearError])

  const sendReply = async () => {
    if (!target) return
    const r = await run(async () => {
      try {
        return await api.post(`/inbox/${target._id}/reply`, { body: text })
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && deviceId) {
          // Fall back to the raw gateway send on the first phone.
          return await api.post(`/gateway/devices/${deviceId}/send-sms`, { recipients: [target.from], message: text })
        }
        throw e
      }
    })
    if (r !== undefined) {
      setDone(true)
      onSent()
    }
  }

  const c = countSms(text)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reply to ${target?.name ?? ''}`}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={sendReply} disabled={busy || !text.trim()}>
              {busy ? 'Sending…' : `Send ${c.segments > 1 ? `${c.segments} texts` : 'text'}`}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice tone="ok">Sent. It goes straight out — replies are not paced like campaigns.</Notice>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-mut">They said:</div>
          <div className="bubble text-sm">{target?.body}</div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Type your reply…" autoFocus />
          <SmsCounter text={text} />
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  )
}

