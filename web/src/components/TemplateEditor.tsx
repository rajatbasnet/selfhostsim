'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { MERGE_TAGS, mergeVars, renderMerge } from '@/lib/merge'
import { withStopLine } from '@/lib/sms'
import type { Channel, Template } from '@/lib/types'
import { SmsCounter } from '@/components/SmsCounter'
import { Button, Field, InlineError, Input, Modal, Select, Textarea } from '@/components/ui'

const SAMPLE = { name: 'Asha Thapa', tags: ['regular'], phone: '+9779812344412', email: 'asha@example.com' }

export function TemplateEditor({ open, template, onClose, onDone, initialBody, initialChannel }: { open: boolean; template: Template | null; onClose: () => void; onDone: (t?: Template) => void; initialBody?: string; initialChannel?: Channel }) {
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('sms')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const { busy, error, run, clearError } = useAction()

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? '')
    setChannel(template?.channel ?? initialChannel ?? 'sms')
    setSubject(template?.subject ?? '')
    setBody(template?.body ?? initialBody ?? '')
    clearError()
  }, [open, template, initialBody, initialChannel, clearError])

  const insert = (tag: string) => {
    const el = bodyRef.current
    const token = `{{${tag}}}`
    if (!el) {
      setBody((b) => b + token)
      return
    }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const isSms = channel === 'sms' || channel === 'both'
  const finalSms = useMemo(() => (isSms ? withStopLine(body) : body), [body, isSms])
  const rendered = useMemo(() => renderMerge(finalSms, mergeVars(SAMPLE, { shop_name: 'Your Shop' })), [finalSms])

  const save = async () => {
    const payload = { name: name.trim(), channel, subject: channel === 'sms' ? undefined : subject.trim() || undefined, body }
    const r = await run(() => (template ? api.patch<Template>(`/templates/${template._id}`, payload) : api.post<Template>('/templates', payload)))
    if (r !== undefined) {
      onDone(r)
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim() || !body.trim()}>
            {busy ? 'Saving…' : 'Save template'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-5">
        <div className="space-y-3 md:col-span-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dashain sale" autoFocus />
            </Field>
            <Field label="Channel">
              <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="both">Both</option>
              </Select>
            </Field>
          </div>
          {channel !== 'sms' && (
            <Field label="Email subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Our Dashain sale starts Friday" />
            </Field>
          )}
          <Field label="Message">
            <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Hi {{first_name}}, our Dashain sale starts Friday. 20% off everything in store." />
          </Field>
          {isSms && <SmsCounter text={finalSms} extra={!/\bstop\b/i.test(body) ? 'STOP line added for you' : undefined} />}
          <div className="flex flex-wrap items-center gap-1 text-xs text-mut">
            <span className="mr-1">Drop in</span>
            {MERGE_TAGS.map((t) => (
              <button key={t} type="button" onClick={() => insert(t)} className="rounded-md border border-line bg-code px-2 py-0.5 font-mono text-xs text-fg hover:bg-greyb">
                {`{{${t}}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-mut">How it reads for Asha</div>
          <div className="rounded-xl border border-line bg-bg p-3">
            {channel !== 'sms' && subject && <div className="mb-2 text-sm font-semibold">{renderMerge(subject, mergeVars(SAMPLE, { shop_name: 'Your Shop' }))}</div>}
            <div className="bubble text-sm">{rendered || <span className="text-mut">Start typing…</span>}</div>
          </div>
          {isSms && <p className="mt-2 text-xs text-mut">“Reply STOP to opt out” is added to every SMS automatically, because remembering it is not a skill anyone should need.</p>}
        </div>
      </div>
      <div className="mt-3">
        <InlineError message={error} />
      </div>
    </Modal>
  )
}
