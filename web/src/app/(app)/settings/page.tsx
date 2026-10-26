'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { fmtNum, hourAcrossZones, hourLabel, timeAgo, titleCase, zoneAbbrev } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { deviceState } from '@/lib/status'
import type { ApiKey, Device, PacingSettings, Settings, SuppressionEntry } from '@/lib/types'
import { Badge, Button, Card, Confirm, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Notice, Table, Td, Th } from '@/components/ui'

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold md:text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-mut">The phone, the email relay, the pacing knobs, API keys, and the do-not-contact list.</p>
      </div>
      <PhoneSection />
      <PacingSection />
      <SmtpSection />
      <ApiKeysSection />
      <SuppressionSection />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PhoneSection() {
  const devices = useLoad(() => api.list<Device>('/gateway/devices'), [], { every: 15000 })
  const { busy, error, run } = useAction()

  const toggle = async (d: Device) => {
    await run(() => api.patch(`/gateway/devices/${d._id}`, { enabled: !(d.enabled !== false) }))
    devices.reload()
  }

  return (
    <Card title="The phone" action={<span className="text-xs text-mut">checked every 15 seconds</span>}>
      {devices.loading && !devices.data ? (
        <Loading />
      ) : devices.error && !devices.data ? (
        <ErrorState compact message={devices.error} onRetry={devices.reload} />
      ) : !devices.data || devices.data.data.length === 0 ? (
        <EmptyState title="No phone connected" body="Install the Sendline Android app, sign in with this account, and the phone appears here. All SMS goes out through it, over your own SIM." />
      ) : (
        <ul className="divide-y divide-line">
          {devices.data.data.map((d) => {
            const st = deviceState(d)
            return (
              <li key={d._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {[d.brand ?? d.manufacturer, d.model].filter(Boolean).join(' ') || 'Android phone'}
                    <Badge tone={st === 'online' ? 'ok' : st === 'unknown' ? 'warn' : 'bad'}>{st === 'online' ? 'online' : st === 'offline' ? 'offline' : 'unknown'}</Badge>
                    {d.enabled === false && <Badge>switched off here</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-mut">
                    last seen {timeAgo(d.lastSeenAt ?? d.updatedAt)}
                    {d.batteryLevel !== undefined && d.batteryLevel !== null ? ` · battery ${d.batteryLevel}%${d.isCharging ? ', charging' : ''}` : ''}
                    {d.signal ? ` · signal ${d.signal}` : ''}
                    {d.simLabel ? ` · SIM ${d.simLabel}` : ''}
                    {d.os ? ` · ${d.os} ${d.osVersion ?? ''}` : ''}
                    {d.appVersionName ? ` · app ${d.appVersionName}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-mut">
                    {fmtNum(d.sentSMSCount)} sent · {fmtNum(d.receivedSMSCount)} received, all time
                  </div>
                </div>
                <Button size="sm" onClick={() => toggle(d)} disabled={busy}>
                  {d.enabled === false ? 'Allow sending' : 'Stop using this phone'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="border-t border-line px-4 py-2">
        <InlineError message={error} />
        <p className="text-xs text-mut">If the phone shows offline: make sure it is on, has internet, and the Sendline app is allowed to run in the background. Nothing sends while it is offline; the queue waits.</p>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

/**
 * A window in UTC is not something anyone can picture. You sit in Central and
 * the people being texted are in Nepal, so the only two clocks that matter are
 * spelled out -- including the day roll, because 20:00 UTC is tomorrow there.
 */
const ELSEWHERE = [
  { zone: 'America/Chicago', name: 'Central' },
  { zone: 'Asia/Kathmandu', name: 'Nepal' },
]

function WindowElsewhere({ startHour, endHour, from }: { startHour: number; endHour: number; from: string }) {
  return (
    <dl className="mt-2 space-y-1">
      {ELSEWHERE.map(({ zone, name }) => {
        if (zone === from) return null
        const a = hourAcrossZones(startHour, from, zone)
        const b = hourAcrossZones(endHour, from, zone)
        const roll = b.dayShift > a.dayShift ? ' (+1 day)' : ''
        return (
          <div key={zone} className="flex items-baseline gap-2 text-sm">
            <dt className="w-32 flex-none text-mut">
              {name} <span className="text-xs">{zoneAbbrev(zone)}</span>
            </dt>
            <dd className="tabular-nums">
              {a.time} to {b.time}
              {roll && <span className="text-mut">{roll}</span>}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** DEFAULT_PACING in api/src/sendline/sendline.enums.ts: what every new campaign starts from. */
const DEFAULT_PACING: Required<PacingSettings> = { ratePerMinute: 10, dailyCap: 500, windowStartHour: 9, windowEndHour: 20, jitterMs: 2000, timezone: 'UTC' }

function PacingSection() {
  // There is no GET /settings on the server. The call is kept so the page picks it up the day it
  // exists; until then it resolves to null and the defaults below are shown.
  const settings = useLoad(() => api.get<Settings>('/settings').catch(() => null as Settings | null), [])
  const p: Required<PacingSettings> = { ...DEFAULT_PACING, ...(settings.data?.pacing ?? {}) }
  const perDayMinutes = p.dailyCap / Math.max(1, p.ratePerMinute)

  return (
    <Card title="Pacing — the four knobs">
      <div className="px-4 pt-3">
        <Notice tone="info">
          These are the defaults every new campaign starts from. Pacing is set per campaign, in the composer&apos;s “When it goes” step, and can be changed on a paused campaign. There is no server-wide setting to save here.
        </Notice>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Messages per minute" hint="10 is about as fast as a person could type. A phone that sends 500 texts in four minutes looks like a spam bot to the carrier, and the punishment is your SIM.">
          <div className="text-lg font-semibold tabular-nums">{fmtNum(p.ratePerMinute)}</div>
        </Field>
        <Field label="Daily cap" hint="A hard stop. Carrier spam thresholds live here. Lower it before you raise it; add a second phone before going above a few hundred.">
          <div className="text-lg font-semibold tabular-nums">{fmtNum(p.dailyCap)}</div>
        </Field>
        <Field label="Sending hours" hint="Nothing goes out outside this window, in the campaign's time zone. Transactional messages from your other apps still go instantly.">
          <div className="text-lg font-semibold tabular-nums">
            {hourLabel(p.windowStartHour)} <span className="text-sm font-normal text-mut">to</span> {hourLabel(p.windowEndHour)}{' '}
            <span className="text-sm font-normal text-mut">{p.timezone}</span>
          </div>
          <WindowElsewhere startHour={p.windowStartHour} endHour={p.windowEndHour} from={p.timezone} />
        </Field>
        <Field label="Spacing wobble" hint="Each message goes out a random couple of seconds early or late, so the phone is never a perfect metronome.">
          <div className="text-lg font-semibold tabular-nums">
            ±{Math.round(p.jitterMs / 1000)} <span className="text-sm font-normal text-mut">seconds</span>
          </div>
        </Field>
        <Field label="Time zone" hint="The composer uses this device's time zone for each new campaign; the server default is shown here.">
          <div className="text-lg font-semibold">{p.timezone}</div>
        </Field>
      </div>
      <div className="border-t border-line px-4 py-3 text-xs text-mut">
        {fmtNum(p.dailyCap)} messages at {p.ratePerMinute} a minute is about {Math.round(perDayMinutes)} minutes of sending a day.
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

/** The variables api/.env reads for the email relay. */
const SMTP_VARS: { name: string; what: string }[] = [
  { name: 'SMTP_HOST', what: 'the server, e.g. smtp.gmail.com, smtp.mailgun.org, or your own' },
  { name: 'SMTP_PORT', what: '587, or 465 with TLS' },
  { name: 'SMTP_SECURE', what: 'true for TLS on port 465' },
  { name: 'SMTP_USER', what: 'the username' },
  { name: 'SMTP_PASS', what: 'the password' },
  { name: 'SMTP_FROM', what: 'what people see as the sender, e.g. "Your Shop <hello@yourshop.com>"' },
]

function SmtpSection() {
  return (
    <Card title="Email relay (SMTP)">
      <div className="space-y-3 p-4 text-sm">
        <Notice tone="info">
          The email relay is configured on the server, in <span className="font-mono">api/.env</span>, not from this page. Edit the file and restart the API; there is nothing to save here.
        </Notice>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {SMTP_VARS.map((v) => (
            <div key={v.name} className="contents">
              <dt className="font-mono text-xs">{v.name}</dt>
              <dd className="text-mut">{v.what}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-mut">To check it works, send yourself a one-person email campaign from the composer.</p>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function ApiKeysSection() {
  const keys = useLoad(() => api.list<ApiKey>('/auth/api-keys'), [])
  const [newName, setNewName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const { busy, error, run } = useAction()

  const create = async () => {
    // POST /auth/api-keys takes no body and returns the full key once, as a string.
    const r = await run(async () => {
      const full = await api.post<string>('/auth/api-keys')
      const wanted = newName.trim()
      if (wanted && typeof full === 'string') {
        // The list stores a masked prefix of each key; find the new one and name it.
        try {
          const all = await api.list<ApiKey>('/auth/api-keys')
          const mine = all.data.find((k) => k.apiKey && full.startsWith(k.apiKey.replace(/\*+$/, '')))
          if (mine) await api.patch(`/auth/api-keys/${mine._id}/rename`, { name: wanted })
        } catch {
          // The key exists either way; it just keeps the default name.
        }
      }
      return full
    })
    if (r !== undefined) {
      setFresh(typeof r === 'string' ? r : null)
      setNewName('')
      keys.reload()
    }
  }
  const revoke = async () => {
    if (!revoking) return
    const r = await run(() => api.post(`/auth/api-keys/${revoking._id}/revoke`))
    if (r !== undefined) {
      setRevoking(null)
      keys.reload()
    }
  }

  return (
    <Card title="API keys — for your other apps">
      <div className="px-4 pt-3 text-xs text-mut">A key lets your till, website or another app send a message through this phone with one request. Order confirmations sent this way jump the queue and are never paced. Marketing sends never skip the consent check.</div>
      {keys.loading && !keys.data ? (
        <Loading />
      ) : keys.error && !keys.data ? (
        <ErrorState compact message={keys.error} onRetry={keys.reload} />
      ) : !keys.data || keys.data.data.length === 0 ? (
        <EmptyState title="No API keys yet" body="Create one below and paste it into the other app." />
      ) : (
        <Table className="mt-2">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th right>Used</Th>
              <Th>Last used</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {keys.data.data.map((k) => (
              <tr key={k._id}>
                <Td className="font-medium">
                  {k.name || 'API key'} {k.revokedAt && <Badge tone="bad">revoked</Badge>}
                </Td>
                <Td mono>{k.apiKey ? `${k.apiKey.slice(0, 10)}…` : '••••••'}</Td>
                <Td right>{fmtNum(k.usageCount)} times</Td>
                <Td className="text-mut">{timeAgo(k.lastUsedAt)}</Td>
                <Td right>
                  {!k.revokedAt && (
                    <Button size="sm" variant="ghost" className="text-bad" onClick={() => setRevoking(k)}>
                      Revoke
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Input placeholder="Name it after the app, e.g. Retail-POS" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-72" />
        <Button variant="primary" onClick={create} disabled={busy}>
          Create a key
        </Button>
      </div>
      <div className="px-4 pb-3">
        <InlineError message={error} />
      </div>
      <Modal open={Boolean(fresh)} onClose={() => setFresh(null)} title="Your new API key" footer={<Button variant="primary" onClick={() => setFresh(null)}>I have copied it</Button>}>
        <div className="space-y-3 text-sm">
          <p>Copy it now. For safety it is shown only this once.</p>
          <code className="block select-all break-all rounded-lg bg-code p-3 font-mono text-xs">{fresh}</code>
          <p className="text-xs text-mut">Send it as the <span className="font-mono">x-api-key</span> header.</p>
        </div>
      </Modal>
      <Confirm open={Boolean(revoking)} onClose={() => setRevoking(null)} onConfirm={revoke} busy={busy} danger title="Revoke this key?" confirmLabel="Revoke" body={<p>Any app using “{revoking?.name || 'this key'}” stops working immediately. This cannot be undone; create a new key instead.</p>} />
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function SuppressionSection() {
  const list = useLoad(() => api.list<SuppressionEntry>('/suppression?limit=100'), [])
  const [value, setValue] = useState('')
  const [removing, setRemoving] = useState<SuppressionEntry | null>(null)
  const { busy, error, run } = useAction()

  const add = async () => {
    const v = value.trim()
    // CreateSuppressionDTO: { value, channel: 'sms' | 'email', reason }
    const body = { value: v.includes('@') ? v.toLowerCase() : v, channel: v.includes('@') ? 'email' : 'sms', reason: 'manual' }
    const r = await run(() => api.post('/suppression', body))
    if (r !== undefined) {
      setValue('')
      list.reload()
    }
  }
  const remove = async () => {
    if (!removing) return
    const r = await run(() => api.del(`/suppression/${removing._id}`))
    if (r !== undefined) {
      setRemoving(null)
      list.reload()
    }
  }

  const reasonLabel = (r?: string) =>
    r === 'stop' ? 'replied STOP' : r === 'bounce' ? 'email bounced' : r === 'complaint' ? 'marked as spam' : r === 'manual' ? 'added by you' : r ? titleCase(r) : 'unknown'

  return (
    <Card title="Do-not-contact list">
      <div className="px-4 pt-3 text-xs text-mut">Everyone here is never messaged, by any campaign, no matter what a CSV import says. People who reply STOP are added automatically within seconds.</div>
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorState compact message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.data.length === 0 ? (
        <EmptyState title="Nobody on the list" body="That is good. Anyone who texts STOP shows up here on their own." />
      ) : (
        <Table className="mt-2">
          <thead>
            <tr>
              <Th>Who</Th>
              <Th>Why</Th>
              <Th>Since</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((s) => (
              <tr key={s._id}>
                <Td mono>{s.value ?? '—'}</Td>
                <Td>{reasonLabel(s.reason)}</Td>
                <Td className="text-mut">{timeAgo(s.createdAt)}</Td>
                <Td right>
                  {s.reason === 'manual' && (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(s)}>
                      Remove
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Input placeholder="+9779812344412 or someone@example.com" value={value} onChange={(e) => setValue(e.target.value)} className="w-80" />
        <Button onClick={add} disabled={busy || !value.trim()}>
          Add to the list
        </Button>
      </div>
      <div className="px-4 pb-3">
        <InlineError message={error} />
      </div>
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={remove} busy={busy} title="Allow messaging this person again?" confirmLabel="Yes, remove" body={<p>Only do this if {removing?.value ?? 'this person'} asked you to. Entries added by a STOP reply cannot be removed here.</p>} />
    </Card>
  )
}
