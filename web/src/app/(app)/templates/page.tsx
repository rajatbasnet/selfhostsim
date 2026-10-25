'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { channelLabel, fmtNum, timeAgo } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { countSms } from '@/lib/sms'
import type { Template } from '@/lib/types'
import { TemplateEditor } from '@/components/TemplateEditor'
import { Badge, Button, Confirm, EmptyState, ErrorState, InlineError, Loading, PageHeader, Table, Td, Th } from '@/components/ui'

export default function TemplatesPage() {
  const templates = useLoad(() => api.list<Template>('/templates?limit=200'), [])
  const [editing, setEditing] = useState<Template | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)
  const { busy, error, run } = useAction()

  const remove = async () => {
    if (!deleting) return
    const r = await run(() => api.del(`/templates/${deleting._id}`))
    if (r !== undefined) {
      setDeleting(null)
      templates.reload()
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Templates"
        subtitle="Write a message once and reuse it. The character count and SMS count update as you type, because 161 characters quietly becomes two texts."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + New template
          </Button>
        }
      />
      <div className="rounded-card border border-line bg-card">
        {templates.loading && !templates.data ? (
          <Loading />
        ) : templates.error && !templates.data ? (
          <ErrorState message={templates.error} onRetry={templates.reload} />
        ) : !templates.data || templates.data.data.length === 0 ? (
          <EmptyState
            title="No templates yet"
            body="A template is the text of a message with blanks like {{first_name}} that get filled in for each person."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                + New template
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Template</Th>
                <Th>Channel</Th>
                <Th>Preview</Th>
                <Th right>Length</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {templates.data.data.map((t) => {
                const c = countSms(t.body ?? '')
                return (
                  <tr key={t._id} className="hover:bg-greyb/50">
                    <Td className="font-medium">
                      <button type="button" className="text-left hover:underline" onClick={() => setEditing(t)}>
                        {t.name || 'Untitled template'}
                      </button>
                    </Td>
                    <Td>{channelLabel(t.channel)}</Td>
                    <Td className="max-w-xs truncate text-mut">{t.subject ? `${t.subject} — ` : ''}{t.body}</Td>
                    <Td right className="whitespace-nowrap">
                      {t.channel === 'email' ? (
                        <span className="text-mut">{fmtNum((t.body ?? '').length)} characters</span>
                      ) : (
                        <Badge tone={c.segments > 1 ? 'warn' : 'grey'}>
                          {c.characters} characters · {c.segments} SMS
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-mut">{timeAgo(t.updatedAt ?? t.createdAt)}</Td>
                    <Td right>
                      <span className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-bad" onClick={() => setDeleting(t)}>
                          Delete
                        </Button>
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </div>

      <TemplateEditor open={editing !== null} template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={templates.reload} />
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this template?"
        body={
          <>
            <p>“{deleting?.name}” will be removed. Campaigns that already used it keep the exact text they sent.</p>
            <InlineError message={error} />
          </>
        }
        confirmLabel="Delete template"
        danger
        busy={busy}
      />
    </div>
  )
}
