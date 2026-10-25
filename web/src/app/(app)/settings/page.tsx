'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { fmtNum, timeAgo, titleCase } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { deviceState } from '@/lib/status'
import type { ApiKey, Device, PacingSettings, Settings, SmtpSettings, SuppressionEntry } from '@/lib/types'
import { Badge, Button, Card, Checkbox, Confirm, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Notice, Table, Td, Th } from '@/components/ui'

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

const DEFAULT_PACING: Required<PacingSettings> = { ratePerMin: 10, dailyCap: 500, windowStart: '09:00', windowEnd: '20:00', jitterSeconds: 2, timezone: 'UTC' }

function PacingSection() {
  const settings = useLoad(() => api.get<Settings>('/settings'), [])
  const [p, setP] = useState<Required<PacingSettings>>(DEFAULT_PACING)
  const [saved, setSaved] = useState(false)
  const { busy, error, run } = useAction()

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    setP({ ...DEFAULT_PACING, timezone: tz, ...(settings.data?.pacing ?? {}) } as Required<PacingSettings>)
  }, [settings.data])

  const save = async () => {
    setSaved(false)
    const r = await run(() => api.patch('/settings', { pacing: p }))
    if (r !== undefined) setSaved(true)
  }

  const perDayMinutes = p.dailyCap / Math.max(1, p.ratePerMin)

  return (
    <Card title="Pacing — the four knobs">
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Messages per minute" hint="10 is about as fast as a person could type. A phone that sends 500 texts in four minutes looks like a spam bot to the carrier, and the punishment is your SIM.">
          <Input type="number" min={1} max={60} value={p.ratePerMin} onChange={(e) => setP({ ...p, ratePerMin: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <Field label="Daily cap" hint="A hard stop. Carrier spam thresholds live here. Lower it before you raise it; add a second phone before going above a few hundred.">
          <Input type="number" min={1} value={p.dailyCap} onChange={(e) => setP({ ...p, dailyCap: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <Field label="Sending hours" hint="Nothing goes out outside this window. Transactional messages from your other apps still go instantly.">
          <div className="flex items-center gap-2">
            <Input type="time" value={p.windowStart} onChange={(e) => setP({ ...p, windowStart: e.target.value })} />
            <span className="text-mut">to</span>
            <Input type="time" value={p.windowEnd} onChange={(e) => setP({ ...p, windowEnd: e.target.value })} />
          </div>
        </Field>
        <Field label="Spacing wobble (seconds)" hint="Each message goes out a random few seconds early or late, so the phone is never a perfect metronome.">
          <Input type="number" min={0} max={30} value={p.jitterSeconds} onChange={(e) => setP({ ...p, jitterSeconds: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
        <Field label="Time zone" hint="Sending hours are read in this zone.">
          <Input value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <div className="text-xs text-mut">
          {fmtNum(p.dailyCap)} messages at {p.ratePerMin} a minute is about {Math.round(perDayMinutes)} minutes of sending a day. Changes apply to the next message, no restart needed.
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-ok">Saved</span>}
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save pacing'}
          </Button>
        </div>
      </div>
      {(error || settings.error) && (
        <div className="px-4 pb-3">
          <InlineError message={error ?? `Could not load the saved pacing: ${settings.error}. The values shown are defaults.`} />
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function SmtpSection() {
  const settings = useLoad(() => api.get<Settings>('/settings'), [])
  const [s, setS] = useState<SmtpSettings>({ host: '', port: 587, secure: false, user: '', password: '', fromName: '', fromEmail: '' })
  const [testTo, setTestTo] = useState('')
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  useEffect(() => {
    if (settings.data?.smtp) setS((prev) => ({ ...prev, ...settings.data?.smtp, password: '' }))
  }, [settings.data])

  const save = async () => {
    setSaved(false)
    const body: SmtpSettings = { ...s }
    if (!body.password) delete body.password // keep the stored one
    const r = await run(() => api.patch('/settings', { smtp: body }))
    if (r !== undefined) setSaved(true)
  }
  const test = async () => {
    setTestResult(null)
    const r = await run(() => api.post<{ ok?: boolean; message?: string }>('/settings/smtp/test', { to: testTo }))
    if (r !== undefined) setTestResult(r?.message ?? `Test email sent to ${testTo}. Check the inbox (and spam).`)
  }

  return (
    <Card title="Email relay (SMTP)">
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Server" hint="e.g. smtp.gmail.com, smtp.mailgun.org, or your own.">
          <Input value={s.host ?? ''} onChange={(e) => setS({ ...s, host: e.target.value })} placeholder="smtp.example.com" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port">
            <Input type="number" value={s.port ?? 587} onChange={(e) => setS({ ...s, port: Number(e.target.value) || 587 })} />
          </Field>
          <div className="pt-7">
            <Checkbox label="Use TLS (port 465)" checked={Boolean(s.secure)} onChange={(e) => setS({ ...s, secure: e.target.checked })} />
          </div>
        </div>
        <Field label="Username">
          <Input value={s.user ?? ''} onChange={(e) => setS({ ...s, user: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Password" hint={settings.data?.smtp?.host ? 'Leave blank to keep the saved one.' : undefined}>
          <Input type="password" value={s.password ?? ''} onChange={(e) => setS({ ...s, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="From name" hint="What people see as the sender.">
          <Input value={s.fromName ?? ''} onChange={(e) => setS({ ...s, fromName: e.target.value })} placeholder="Your Shop" />
        </Field>
        <Field label="From email">
          <Input type="email" value={s.fromEmail ?? ''} onChange={(e) => setS({ ...s, fromEmail: e.target.value })} placeholder="hello@yourshop.com" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="w-56" aria-label="Send a test email to" />
          <Button onClick={test} disabled={busy || !testTo}>
            Send a test email
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-ok">Saved</span>}
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save email settings'}
          </Button>
        </div>
      </div>
      {(testResult || error) && (
        <div className="space-y-2 px-4 pb-3">
          {testResult && <Notice tone="ok">{testResult}</Notice>}
          <InlineError message={error} />
        </div>
      )}
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
    const r = await run(() => api.post<ApiKey | string>('/auth/api-keys', { name: newName.trim() || undefined }))
    if (r !== undefined) {
      const full = typeof r === 'string' ? r : r?.apiKey ?? null
      setFresh(full)
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
    const body = v.includes('@') ? { email: v.toLowerCase(), reason: 'manual' } : { phone: v, reason: 'manual' }
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
                <Td mono>{s.phone ?? s.email ?? '—'}</Td>
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
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={remove} busy={busy} title="Allow messaging this person again?" confirmLabel="Yes, remove" body={<p>Only do this if {removing?.phone ?? removing?.email} asked you to. Entries added by a STOP reply cannot be removed here.</p>} />
    </Card>
  )
}
