'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api, qs } from '@/lib/api'
import { displayName, fmtNum, maskEmail, maskPhone, timeAgo } from '@/lib/format'
import { useAction, useDebounced, useLoad } from '@/lib/hooks'
import type { Contact, ContactList } from '@/lib/types'
import { Badge, Button, Confirm, ConsentBadge, EmptyState, ErrorState, Field, InlineError, Input, LinkButton, Loading, Modal, PageHeader, Pager, Table, Td, Th } from '@/components/ui'

export default function ListsPage() {
  const lists = useLoad(() => api.list<ContactList>('/lists?limit=200'), [])
  const [editing, setEditing] = useState<ContactList | null | 'new'>(null)
  const [viewing, setViewing] = useState<ContactList | null>(null)
  const [deleting, setDeleting] = useState<ContactList | null>(null)
  const { busy, error, run } = useAction()

  const remove = async () => {
    if (!deleting) return
    const r = await run(() => api.del(`/lists/${deleting._id}`))
    if (r !== undefined) {
      setDeleting(null)
      lists.reload()
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Lists"
        subtitle="A list is a group of people you send to. Build one by hand, or save a search on the Contacts page as a list that keeps itself up to date."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + New list
          </Button>
        }
      />
      <div className="rounded-card border border-line bg-card">
        {lists.loading && !lists.data ? (
          <Loading />
        ) : lists.error && !lists.data ? (
          <ErrorState message={lists.error} onRetry={lists.reload} />
        ) : !lists.data || lists.data.data.length === 0 ? (
          <EmptyState
            title="No lists yet"
            body={
              <>
                Make one here, or go to <Link href="/contacts" className="text-link underline">Contacts</Link>, filter, and press “Text these people”.
              </>
            }
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                + New list
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>List</Th>
                <Th>Kind</Th>
                <Th right>People</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lists.data.data.map((l) => (
                <tr key={l._id} className="hover:bg-greyb/50">
                  <Td className="font-medium">
                    <button type="button" className="hover:underline" onClick={() => setViewing(l)}>
                      {l.name || 'Untitled list'}
                    </button>
                  </Td>
                  <Td>
                    {l.type === 'dynamic' ? <Badge tone="info" title="Built from a saved search; updates itself as contacts change.">keeps itself updated</Badge> : <Badge>picked by hand</Badge>}
                  </Td>
                  <Td right>{fmtNum(l.memberCount ?? l.contactIds?.length)}</Td>
                  <Td className="text-mut">{timeAgo(l.updatedAt ?? l.createdAt)}</Td>
                  <Td right>
                    <span className="flex justify-end gap-1">
                      <LinkButton href={`/campaigns/new?listId=${l._id}`} variant="ghost" className="!px-2 !py-1 text-xs">
                        Send to
                      </LinkButton>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                        Rename
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(l)} className="text-bad">
                        Delete
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <ListEditor open={editing !== null} list={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={lists.reload} />
      <MembersModal list={viewing} onClose={() => setViewing(null)} onChanged={lists.reload} />
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this list?"
        body={
          <>
            <p>“{deleting?.name}” will be removed. The people in it are not deleted, and past campaigns keep their reports.</p>
            <InlineError message={error} />
          </>
        }
        confirmLabel="Delete list"
        danger
        busy={busy}
      />
    </div>
  )
}

function ListEditor({ open, list, onClose, onDone }: { open: boolean; list: ContactList | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const { busy, error, run, clearError } = useAction()
  useEffect(() => {
    if (open) {
      setName(list?.name ?? '')
      clearError()
    }
  }, [open, list, clearError])

  const save = async () => {
    const body = { name: name.trim(), type: list?.type ?? 'static' }
    const r = await run(() => (list ? api.patch<ContactList>(`/lists/${list._id}`, body) : api.post<ContactList>('/lists', body)))
    if (r !== undefined) {
      onDone()
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={list ? 'Rename list' : 'New list'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : list ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" hint={list ? undefined : 'After creating it, open the list to add people.'}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Regulars" autoFocus />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  )
}

function MembersModal({ list, onClose, onChanged }: { list: ContactList | null; onClose: () => void; onChanged: () => void }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  const { busy, error, run } = useAction()
  const open = Boolean(list)
  const id = list?._id

  useEffect(() => {
    setPage(1)
    setSearch('')
  }, [id])

  const members = useLoad(() => (id ? api.list<Contact>(`/lists/${id}/members${qs({ page, limit: 25 })}`) : Promise.resolve({ data: [] })), [id, page])
  const candidates = useLoad(() => (id && q ? api.list<Contact>(`/contacts${qs({ search: q, limit: 8 })}`) : Promise.resolve({ data: [] })), [id, q])

  const add = async (c: Contact) => {
    if (!id) return
    const r = await run(() => api.post(`/lists/${id}/members`, { contactIds: [c._id] }))
    if (r !== undefined) {
      setSearch('')
      members.reload()
      onChanged()
    }
  }
  const removeMember = async (c: Contact) => {
    if (!id) return
    const r = await run(() => api.del(`/lists/${id}/members/${c._id}`))
    if (r !== undefined) {
      members.reload()
      onChanged()
    }
  }

  const dynamic = list?.type === 'dynamic'

  return (
    <Modal open={open} onClose={onClose} title={list?.name ?? 'List'} wide footer={<LinkButton href={id ? `/campaigns/new?listId=${id}` : '/campaigns/new'} variant="primary">Send to this list</LinkButton>}>
      <div className="space-y-3">
        {dynamic ? (
          <div className="rounded-lg bg-infob px-3 py-2 text-sm text-info">This list keeps itself updated from a saved search, so you cannot add or remove people by hand. Edit the people themselves on the Contacts page.</div>
        ) : (
          <div className="relative">
            <Input placeholder="Add someone: type a name, number or email…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people to add" />
            {q && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-card shadow-lg">
                {candidates.loading ? (
                  <div className="px-3 py-2 text-sm text-mut">Searching…</div>
                ) : candidates.error ? (
                  <div className="px-3 py-2 text-sm text-bad">{candidates.error}</div>
                ) : !candidates.data || candidates.data.data.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-mut">Nobody matches.</div>
                ) : (
                  candidates.data.data.map((c) => (
                    <button key={c._id} type="button" onClick={() => add(c)} disabled={busy} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-greyb">
                      <span>
                        <span className="font-medium">{displayName(c)}</span> <span className="text-mut">{maskPhone(c.phone)}</span>
                      </span>
                      <span className="text-xs text-link">Add</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <InlineError message={error} />
        <div className="rounded-lg border border-line">
          {members.loading && !members.data ? (
            <Loading />
          ) : members.error ? (
            <ErrorState compact message={members.error} onRetry={members.reload} />
          ) : !members.data || members.data.data.length === 0 ? (
            <EmptyState title="Nobody in this list yet" body={dynamic ? 'No contacts match its search right now.' : 'Search above to add people.'} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Email</Th>
                    <Th>SMS</Th>
                    <Th>Email ok</Th>
                    {!dynamic && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {members.data.data.map((c) => (
                    <tr key={c._id}>
                      <Td className="font-medium">{displayName(c)}</Td>
                      <Td mono>{maskPhone(c.phone)}</Td>
                      <Td className="text-mut">{maskEmail(c.email)}</Td>
                      <Td>
                        <ConsentBadge channel="sms" consent={c.smsConsent} optedOut={Boolean(c.optedOutAt) || Boolean(c.suppressed)} />
                      </Td>
                      <Td>
                        <ConsentBadge channel="email" consent={c.emailConsent} />
                      </Td>
                      {!dynamic && (
                        <Td right>
                          <Button variant="ghost" size="sm" onClick={() => removeMember(c)} disabled={busy}>
                            Remove
                          </Button>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pager page={page} totalPages={members.data.meta?.totalPages} total={members.data.meta?.total} noun="people" onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
