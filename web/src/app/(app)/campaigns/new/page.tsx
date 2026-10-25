'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, describeError, qs } from '@/lib/api'
import { aboutMinutes, displayName, firstName, fmtDateTime, fmtNum, hourLabel, idOf, SKIP_REASONS, titleCase } from '@/lib/format'
import { useAction, useDebounced, useLoad } from '@/lib/hooks'
import { MERGE_TAGS, mergeVars, renderMerge } from '@/lib/merge'
import { countSms, withStopLine } from '@/lib/sms'
import { fetchPhoneStatus } from '@/lib/status'
import type { Campaign, CampaignInput, CampaignPreview, Channel, Contact, ContactList, Settings, Template } from '@/lib/types'
import { SmsCounter } from '@/components/SmsCounter'
import { TemplateEditor } from '@/components/TemplateEditor'
import { Button, Confirm, ErrorState, Field, InlineError, Input, Loading, Notice, Select, Textarea } from '@/components/ui'

type Step = 1 | 2 | 3

/** Suffix on the MessageTemplate the composer creates for ad-hoc text, so a resumed draft edits it instead of making another. */
const ADHOC_SUFFIX = ' (sent copy)'

const HOURS = Array.from({ length: 25 }, (_, h) => h)

function heldEntries(h: Record<string, number> | undefined): { key: string; n: number; label: string; why: string }[] {
  if (!h) return []
  return Object.entries(h)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([k, v]) => ({ key: k, n: v, label: SKIP_REASONS[k]?.label ?? titleCase(k).toLowerCase(), why: SKIP_REASONS[k]?.why ?? '' }))
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Composer />
    </Suspense>
  )
}

function Composer() {
  const router = useRouter()
  const params = useSearchParams()
  const presetList = params.get('listId')
  const draftParam = params.get('draft')

  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [listId, setListId] = useState(presetList ?? '')
  const [templateId, setTemplateId] = useState('')
  const [channel, setChannel] = useState<Channel>('sms')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [windowStartHour, setWindowStartHour] = useState(9)
  const [windowEndHour, setWindowEndHour] = useState(20)
  const [ratePerMin, setRatePerMin] = useState(10)
  const [dailyCap, setDailyCap] = useState(500)
  const [draftId, setDraftId] = useState<string | null>(draftParam)
  const [draftLoaded, setDraftLoaded] = useState(!draftParam)
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const send = useAction()
  const adhocRef = useRef<string | null>(null)
  const adhocSigRef = useRef<string>('')
  const draftIdRef = useRef<string | null>(draftParam)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const lists = useLoad(() => api.list<ContactList>('/lists?limit=200'), [])
  const templates = useLoad(() => api.list<Template>('/templates?limit=200'), [])
  // There is no GET /settings on the server yet; this resolves to null and the shop name falls back below.
  const settings = useLoad(() => api.get<Settings>('/settings').catch(() => null as Settings | null), [])
  // An SMS campaign must name the phone that sends it. Pick the most recently seen one.
  const phone = useLoad(() => fetchPhoneStatus(), [])
  const deviceId = phone.data?.device?._id ?? ''

  // Resume an existing draft.
  useEffect(() => {
    if (!draftParam) return
    let alive = true
    api
      .get<Campaign>(`/campaigns/${draftParam}`)
      .then(async (c) => {
        if (!alive || !c) return
        setName(c.name ?? '')
        setListId(idOf(c.list))
        setChannel(c.channel === 'email' ? 'email' : 'sms')
        if (c.pacing?.windowStartHour !== undefined) setWindowStartHour(c.pacing.windowStartHour)
        if (c.pacing?.windowEndHour !== undefined) setWindowEndHour(c.pacing.windowEndHour)
        if (c.pacing?.ratePerMinute) setRatePerMin(c.pacing.ratePerMinute)
        if (c.pacing?.dailyCap !== undefined) setDailyCap(c.pacing.dailyCap)
        if (c.scheduledAt) {
          setWhen('later')
          setScheduledAt(c.scheduledAt.slice(0, 16))
        }
        const tid = idOf(c.template)
        if (tid) {
          try {
            const t = await api.get<Template>(`/templates/${tid}`)
            if (!alive) return
            if (t?.name?.endsWith(ADHOC_SUFFIX)) {
              // Text written in the composer: keep editing the same template.
              adhocRef.current = tid
              setBody(t.body ?? '')
              setSubject(t.subject ?? '')
            } else {
              setTemplateId(tid)
            }
          } catch {
            // Template gone; the person writes the text again.
          }
        }
        if (idOf(c.list)) setStep(2)
      })
      .catch(() => {
        // The draft is gone; start a fresh campaign instead of patching a missing one.
        draftIdRef.current = null
        setDraftId(null)
      })
      .finally(() => alive && setDraftLoaded(true))
    return () => {
      alive = false
    }
  }, [draftParam])

  // When a template is picked, copy its text in.
  useEffect(() => {
    if (!templateId) return
    const t = templates.data?.data.find((x) => x._id === templateId)
    if (!t) return
    setBody(t.body ?? '')
    setSubject(t.subject ?? '')
    setChannel(t.channel === 'email' ? 'email' : 'sms')
  }, [templateId, templates.data])

  const selectedList = lists.data?.data.find((l) => l._id === listId)
  const isSms = channel === 'sms'
  const finalBody = useMemo(() => (isSms ? withStopLine(body) : body), [body, isSms])
  const sms = countSms(finalBody)
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [])

  /* ---------- draft on the server + server preview ---------- */

  // Everything the server needs. A campaign always points at a MessageTemplate,
  // so ad-hoc text becomes one (named "<campaign> (sent copy)") before the draft is saved.
  const draftPayload = useMemo(
    () => ({
      name: name.trim() || 'Untitled campaign',
      listId,
      templateId,
      channel,
      body: finalBody,
      subject: channel === 'email' ? subject.trim() : '',
      deviceId: isSms ? deviceId : '',
      scheduledAt: when === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      pacing: { ratePerMinute: ratePerMin, dailyCap, windowStartHour, windowEndHour, timezone },
    }),
    [name, listId, templateId, channel, finalBody, subject, isSms, deviceId, when, scheduledAt, ratePerMin, dailyCap, windowStartHour, windowEndHour, timezone],
  )
  type DraftPayload = typeof draftPayload
  const debouncedPayload = useDebounced(draftPayload, 700)
  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  /** Returns the template id the campaign should point at, creating or updating the ad-hoc one when needed. */
  const ensureTemplate = useCallback(async (p: DraftPayload): Promise<string | null> => {
    if (p.templateId) return p.templateId
    if (!p.body.trim()) return null
    if (p.channel === 'email' && !p.subject) return null
    const tpl = { name: `${p.name}${ADHOC_SUFFIX}`, channel: p.channel, subject: p.channel === 'email' ? p.subject : undefined, body: p.body }
    const sig = JSON.stringify(tpl)
    if (adhocRef.current && sig === adhocSigRef.current) return adhocRef.current
    if (adhocRef.current) {
      await api.patch<Template>(`/templates/${adhocRef.current}`, tpl)
    } else {
      const t = await api.post<Template>('/templates', tpl)
      if (!t?._id) throw new Error('The server did not save the message text.')
      adhocRef.current = t._id
    }
    adhocSigRef.current = sig
    return adhocRef.current
  }, [])

  /** Create or update the draft on the server. Serialised, so a slow save never loses the newest text. */
  const syncDraft = useCallback(
    (p: DraftPayload): Promise<string | null> => {
      const job = queueRef.current.then(async () => {
        if (!p.listId) return draftIdRef.current
        try {
          const template = await ensureTemplate(p)
          if (!template) return draftIdRef.current
          const input: Partial<CampaignInput> = {
            name: p.name,
            channel: p.channel,
            template,
            list: p.listId,
            pacing: p.pacing,
          }
          if (p.channel === 'sms' && p.deviceId) input.device = p.deviceId
          let id = draftIdRef.current
          if (!id) {
            if (p.scheduledAt) input.scheduledAt = p.scheduledAt
            const c = await api.post<Campaign>('/campaigns', input)
            id = c?._id ?? null
            if (id) {
              draftIdRef.current = id
              setDraftId(id)
            }
          } else {
            input.scheduledAt = p.scheduledAt
            await api.patch<Campaign>(`/campaigns/${id}`, input)
          }
          setDraftError(null)
          return id
        } catch (e) {
          setDraftError(describeError(e))
          return draftIdRef.current
        }
      })
      queueRef.current = job.catch(() => undefined)
      return job
    },
    [ensureTemplate],
  )

  useEffect(() => {
    if (!draftLoaded || step < 2 || !debouncedPayload.listId) return
    let alive = true
    setPreviewLoading(true)
    syncDraft(debouncedPayload)
      .then(async (id) => {
        if (!id) return
        const p = await api.get<CampaignPreview>(`/campaigns/${id}/preview`)
        if (!alive) return
        setPreview(p ?? null)
        setPreviewError(null)
      })
      .catch((e) => {
        if (!alive) return
        setPreview(null)
        setPreviewError(describeError(e))
      })
      .finally(() => alive && setPreviewLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPayload, step, draftLoaded])

  /* ---------- local fallback when the server has no preview yet ---------- */

  const members = useLoad(
    () => (listId ? api.list<Contact>(`/lists/${listId}/members${qs({ limit: 100 })}`).catch(() => ({ data: [] as Contact[] })) : Promise.resolve({ data: [] as Contact[] })),
    [listId],
  )
  const local = useMemo(() => {
    const all = members.data?.data ?? []
    const held: Record<string, number> = {}
    const seen = new Set<string>()
    const eligible: Contact[] = []
    const bump = (k: string) => (held[k] = (held[k] ?? 0) + 1)
    for (const c of all) {
      const to = isSms ? c.phone : c.email
      const consent = isSms ? c.smsConsent : c.emailConsent
      if (c.optedOutAt) bump('suppressed')
      else if (!to) bump('invalid_address')
      else if (!consent) bump('no_consent')
      else if (seen.has(to)) bump('duplicate')
      else {
        seen.add(to)
        eligible.push(c)
      }
    }
    return { total: all.length, eligible, held, partial: (selectedList?.memberCount ?? all.length) > all.length }
  }, [members.data, isSms, selectedList])

  /* ---------- the numbers the right pane shows ---------- */

  const shopName = settings.data?.shopName ?? 'Your Shop'
  const first = preview?.samples?.[0]
  const firstContact: Partial<Contact> | undefined = first ? { _id: first.contactId, name: first.contactName } : local.eligible[0]
  const renderedBody = first?.body ?? (firstContact ? renderMerge(finalBody, mergeVars(firstContact, { shop_name: shopName })) : renderMerge(finalBody, mergeVars(undefined, { shop_name: shopName })))
  const renderedSubject = first?.subject ?? (subject ? renderMerge(subject, mergeVars(firstContact, { shop_name: shopName })) : '')
  const nextNames = preview?.samples
    ? preview.samples.slice(1, 3).map((s) => firstName({ name: s.contactName }) || s.contactName || s.recipient)
    : local.eligible.slice(1, 3).map((c) => firstName(c) || displayName(c))
  const audience = preview?.eligibleCount ?? (local.partial ? undefined : local.eligible.length)
  const selectedCount = preview?.audienceSize ?? selectedList?.memberCount ?? local.total
  const held = heldEntries(preview?.skippedByReason ?? local.held)
  const heldTotal = preview?.skippedCount ?? held.reduce((a, b) => a + b.n, 0)
  const segs = preview?.segmentsPerMessage ?? (isSms ? Math.max(1, sms.segments) : 1)
  const minutes = preview?.estimatedDurationMs !== undefined ? preview.estimatedDurationMs / 60000 : audience !== undefined ? (audience * segs) / Math.max(1, ratePerMin) : undefined
  const days = minutes !== undefined && dailyCap > 0 && audience !== undefined && audience * segs > dailyCap ? Math.ceil((audience * segs) / dailyCap) : 1
  const usingLocal = !preview
  const warnings = preview?.warnings ?? []

  /* ---------- actions ---------- */

  const insert = (tag: string) => {
    const el = bodyRef.current
    const token = `{{${tag}}}`
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    setTemplateId('')
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const noPhone = isSms && !phone.loading && !deviceId
  const canNext1 = Boolean(listId)
  const canNext2 = body.trim().length > 0 && (channel === 'sms' || subject.trim().length > 0)
  const canSend = canNext1 && canNext2 && (when === 'now' || Boolean(scheduledAt)) && (audience === undefined || audience > 0) && !noPhone

  const doSend = async () => {
    const r = await send.run(async () => {
      // Make sure the draft on the server has the latest text, then start it.
      const id = await syncDraft(draftPayload)
      if (!id) throw new Error('The server did not save the campaign. Check the message text and try again.')
      if (when === 'now') await api.post(`/campaigns/${id}/start`)
      return id
    })
    if (r) {
      setConfirmSend(false)
      router.push(`/campaigns/${r}`)
    }
  }

  if (!draftLoaded) return <Loading rows={4} />

  const stepTitle = ['Who gets it', 'What it says', 'When it goes']

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">New campaign</h1>
          <div className="text-sm text-mut">step {step} of 3</div>
        </div>
        <ol className="flex items-center gap-2 text-sm">
          {stepTitle.map((t, i) => {
            const n = (i + 1) as Step
            const done = n < step
            const active = n === step
            return (
              <li key={t} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (done || (n === 2 && canNext1) || (n === 3 && canNext1 && canNext2)) && setStep(n)}
                  className={`flex items-center gap-2 rounded-full px-3 py-1 ${active ? 'bg-fg text-bg' : done ? 'text-ok' : 'text-mut'}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${active ? 'bg-bg text-fg' : done ? 'bg-okb' : 'bg-greyb'}`}>{done ? '✓' : n}</span>
                  <span className="hidden sm:inline">{t}</span>
                </button>
                {i < 2 && <span className="text-line">—</span>}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ---------- left: the form ---------- */}
        <div className="space-y-4 lg:col-span-3">
          <div className="rounded-card border border-line bg-card p-4 md:p-5">
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">Who gets it</h2>
                <Field label="Name this campaign" hint="Just for you, so you can find it in reports later.">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="October promo" autoFocus />
                </Field>
                <Field label="Send to this list">
                  {lists.loading && !lists.data ? (
                    <Loading rows={2} />
                  ) : lists.error && !lists.data ? (
                    <ErrorState compact message={lists.error} onRetry={lists.reload} />
                  ) : !lists.data || lists.data.data.length === 0 ? (
                    <Notice tone="warn">
                      You have no lists yet. Go to <Link href="/contacts" className="underline">Contacts</Link>, filter, and press “Text these people”, or make one under <Link href="/lists" className="underline">Lists</Link>.
                    </Notice>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {lists.data.data.map((l) => (
                        <button
                          key={l._id}
                          type="button"
                          onClick={() => setListId(l._id)}
                          className={`rounded-lg border px-3 py-2 text-left text-sm transition ${listId === l._id ? 'border-fg bg-greyb' : 'border-line hover:bg-greyb/50'}`}
                        >
                          <div className="font-medium">{l.name}</div>
                          <div className="text-xs text-mut">
                            {l.memberCount !== undefined ? `${fmtNum(l.memberCount)} people` : l.type === 'dynamic' ? 'keeps itself updated' : l.contactIds ? `${fmtNum(l.contactIds.length)} people` : 'picked by hand'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
                <div className="flex justify-end">
                  <Button variant="primary" disabled={!canNext1} onClick={() => setStep(2)}>
                    Next: what it says →
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">What it says</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Start from a template" hint="Optional. You can edit the text after.">
                    <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      <option value="">— write it fresh —</option>
                      {(templates.data?.data ?? []).map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Channel">
                    <div className="flex gap-1 rounded-lg border border-line p-1">
                      {(['sms', 'email'] as Channel[]).map((c) => (
                        <button key={c} type="button" onClick={() => setChannel(c)} className={`flex-1 rounded-md px-2 py-1.5 text-sm ${channel === c ? 'bg-fg text-bg' : 'hover:bg-greyb'}`}>
                          {c === 'sms' ? 'SMS' : 'Email'}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
                {channel !== 'sms' && (
                  <Field label="Email subject">
                    <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Our Dashain sale starts Friday" />
                  </Field>
                )}
                <Field label="Message">
                  <Textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value)
                      if (templateId) setTemplateId('')
                    }}
                    rows={6}
                    placeholder="Hi {{first_name}}, our Dashain sale starts Friday. 20% off everything in store."
                    autoFocus
                  />
                </Field>
                {isSms && <SmsCounter text={finalBody} extra={!/\bstop\b/i.test(body) ? 'STOP line added for you' : undefined} />}
                <div className="flex flex-wrap items-center gap-1 text-xs text-mut">
                  <span className="mr-1">Drop in</span>
                  {MERGE_TAGS.map((t) => (
                    <button key={t} type="button" onClick={() => insert(t)} className="rounded-md border border-line bg-code px-2 py-0.5 font-mono text-xs text-fg hover:bg-greyb">
                      {`{{${t}}}`}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" onClick={() => setSaveTplOpen(true)} disabled={!body.trim()}>
                    Save as template
                  </Button>
                  <div className="flex gap-2">
                    <Button onClick={() => setStep(1)}>← Back</Button>
                    <Button variant="primary" disabled={!canNext2} onClick={() => setStep(3)}>
                      Next: when →
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">When it goes</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => setWhen('now')} className={`rounded-lg border px-3 py-3 text-left text-sm ${when === 'now' ? 'border-fg bg-greyb' : 'border-line hover:bg-greyb/50'}`}>
                    <div className="font-medium">Start now</div>
                    <div className="text-xs text-mut">Begins within a minute, inside the sending hours below.</div>
                  </button>
                  <button type="button" onClick={() => setWhen('later')} className={`rounded-lg border px-3 py-3 text-left text-sm ${when === 'later' ? 'border-fg bg-greyb' : 'border-line hover:bg-greyb/50'}`}>
                    <div className="font-medium">Schedule for later</div>
                    <div className="text-xs text-mut">Pick a day and time. You can cancel any time before.</div>
                  </button>
                </div>
                {when === 'later' && (
                  <>
                    <Field label="Start at">
                      <Input type="datetime-local" value={scheduledAt} min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)} onChange={(e) => setScheduledAt(e.target.value)} />
                    </Field>
                    <Notice tone="warn">The server does not start campaigns on a timer yet. “Schedule it” saves this campaign as a draft with the start time; when the time comes, open it from Campaigns and press Send.</Notice>
                  </>
                )}
                <div className="rounded-lg border border-line bg-bg p-3">
                  <div className="mb-2 text-sm font-semibold">Pace</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Sending hours" hint="Nothing goes out outside these hours, in your time zone. Whole hours.">
                      <div className="flex items-center gap-2">
                        <Select value={windowStartHour} onChange={(e) => setWindowStartHour(Number(e.target.value))} aria-label="Sending starts at">
                          {HOURS.filter((h) => h < 24).map((h) => (
                            <option key={h} value={h}>
                              {hourLabel(h)}
                            </option>
                          ))}
                        </Select>
                        <span className="text-mut">to</span>
                        <Select value={windowEndHour} onChange={(e) => setWindowEndHour(Number(e.target.value))} aria-label="Sending stops at">
                          {HOURS.filter((h) => h > 0).map((h) => (
                            <option key={h} value={h}>
                              {hourLabel(h)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </Field>
                    <Field label="Messages per minute" hint="10 is about as fast as a person could type. Faster looks like spam to the carrier.">
                      <Input type="number" min={1} max={60} value={ratePerMin} onChange={(e) => setRatePerMin(Math.max(1, Number(e.target.value) || 1))} />
                    </Field>
                    <Field label="Daily cap" hint="A hard stop. If the campaign is bigger, it continues tomorrow.">
                      <Input type="number" min={1} value={dailyCap} onChange={(e) => setDailyCap(Math.max(1, Number(e.target.value) || 1))} />
                    </Field>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button onClick={() => setStep(2)}>← Back</Button>
                  <Button variant="primary" size="lg" disabled={!canSend || send.busy} onClick={() => setConfirmSend(true)}>
                    {when === 'now' ? `Send to ${audience !== undefined ? fmtNum(audience) + ' people' : 'this list'}` : 'Schedule it'}
                  </Button>
                </div>
                {noPhone && (
                  <Notice tone="bad">
                    No phone is connected, so SMS cannot go out. Install the Sendline app on an Android phone and sign in, or switch this campaign to email. <Link href="/settings" className="underline">Settings</Link>
                  </Notice>
                )}
                {audience === 0 && <Notice tone="bad">Nobody in this list can receive this message. Everyone is held back — see the right-hand pane for why.</Notice>}
                <InlineError message={send.error} />
              </div>
            )}
          </div>
          {draftError && step >= 2 && <Notice tone="warn">Could not save the draft on the server: {draftError}. Your text is kept here until you send.</Notice>}
        </div>

        {/* ---------- right: what will actually arrive ---------- */}
        <aside className="lg:col-span-2">
          <div className="sticky top-20 space-y-3">
            <div className="rounded-card border border-line bg-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-mut">
                Exactly what {firstContact ? firstName(firstContact) || displayName(firstContact) : 'the first person'} will see
              </div>
              {step < 2 && !body ? (
                <div className="text-sm text-mut">Pick a list, then write the message. This pane shows the real text the first real person receives.</div>
              ) : (
                <div className="rounded-xl bg-bg p-3">
                  <div className="mb-1 text-xs text-mut">{isSms ? shopName : `From: ${shopName}`}</div>
                  {!isSms && renderedSubject && <div className="mb-1 text-sm font-semibold">{renderedSubject}</div>}
                  <div className="bubble text-sm">{renderedBody || <span className="text-mut">…</span>}</div>
                  {nextNames.length > 0 && <div className="mt-2 text-xs text-mut">next: {nextNames.join(', ')} →</div>}
                </div>
              )}
              {first && first.missingTags && first.missingTags.length > 0 && (
                <div className="mt-2 text-xs text-warn">
                  {first.missingTags.map((t) => `{{${t}}}`).join(', ')} {first.missingTags.length === 1 ? 'has' : 'have'} no value for this person and will be blank.
                </div>
              )}
              {previewLoading && <div className="mt-2 text-xs text-mut">Checking the audience…</div>}
            </div>

            <div className="rounded-card border border-line bg-card p-4 text-sm">
              {!listId ? (
                <div className="text-mut">No list picked yet.</div>
              ) : (
                <dl className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-mut">going to</dt>
                    <dd className="text-right text-lg font-semibold tabular-nums">
                      {audience !== undefined ? `${fmtNum(audience)} people` : local.partial ? `up to ${fmtNum(selectedCount)} people` : '…'}
                    </dd>
                  </div>
                  {audience !== undefined && selectedCount !== undefined && selectedCount !== audience && (
                    <div className="text-xs text-mut">{fmtNum(selectedCount)} in the list, {fmtNum(Math.max(0, selectedCount - audience))} held back</div>
                  )}
                  {held.length > 0 ? (
                    <div className="rounded-lg bg-bg p-2">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-mut">held back · {fmtNum(heldTotal)}</div>
                      <ul className="space-y-0.5">
                        {held.map((h) => (
                          <li key={h.key} className="flex justify-between gap-2">
                            <span>
                              <span className="font-semibold tabular-nums">{fmtNum(h.n)}</span> {h.label}
                            </span>
                            <span className="text-right text-xs text-mut">{h.why}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    audience !== undefined && <div className="text-xs text-ok">nobody held back</div>
                  )}
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-mut">takes</dt>
                    <dd className="text-right">
                      {minutes !== undefined ? aboutMinutes(minutes) : '…'}
                      {days > 1 && <span className="block text-xs text-warn">spread over {days} days by the daily cap</span>}
                      {preview?.windowOpenNow === false && preview.nextWindowOpeningAt && <span className="block text-xs text-warn">sending hours are closed now; opens {fmtDateTime(preview.nextWindowOpeningAt)}</span>}
                      {preview?.estimatedCompletionAt && audience !== undefined && audience > 0 && <span className="block text-xs text-mut">done by {fmtDateTime(preview.estimatedCompletionAt)}</span>}
                    </dd>
                  </div>
                  {isSms && segs > 1 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-mut">each person gets</dt>
                      <dd className="text-warn">{segs} texts</dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-mut">costs you</dt>
                    <dd>nothing per message</dd>
                  </div>
                  {warnings.length > 0 && (
                    <ul className="space-y-0.5 border-t border-line pt-2 text-xs text-warn">
                      {warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {usingLocal && step >= 2 && (
                    <div className="border-t border-line pt-2 text-xs text-mut">
                      {previewError ? 'The server could not preview this yet, so these numbers are ' : 'These numbers are '}
                      worked out on this device{local.partial ? ' from the first 100 people' : ''}. The server does the real count before anything goes out.
                    </div>
                  )}
                </dl>
              )}
            </div>
          </div>
        </aside>
      </div>

      <TemplateEditor
        open={saveTplOpen}
        template={null}
        initialBody={body}
        initialChannel={channel}
        initialSubject={subject}
        onClose={() => setSaveTplOpen(false)}
        onDone={(t) => {
          templates.reload()
          if (t?._id) setTemplateId(t._id)
        }}
      />
      <Confirm
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        onConfirm={doSend}
        busy={send.busy}
        title={when === 'now' ? 'Send it now?' : 'Schedule it?'}
        confirmLabel={when === 'now' ? 'Yes, send' : 'Yes, schedule'}
        body={
          <div className="space-y-2">
            <p>
              <strong>{audience !== undefined ? fmtNum(audience) : 'The eligible'} people</strong> in “{selectedList?.name ?? 'this list'}” will get {isSms ? `${segs} SMS` : 'an email'} each
              {when === 'later' && scheduledAt ? `, starting ${new Date(scheduledAt).toLocaleString()}` : ''}, at {ratePerMin} a minute between {hourLabel(windowStartHour)} and {hourLabel(windowEndHour)}.
            </p>
            {heldTotal > 0 && <p className="text-mut">{fmtNum(heldTotal)} are held back and will not be contacted.</p>}
            {when === 'later' ? <p className="text-mut">It is saved as a draft with this start time. Open it and press Send when the time comes.</p> : <p className="text-mut">You can pause from the dashboard at any point.</p>}
          </div>
        }
      />
    </div>
  )
}
