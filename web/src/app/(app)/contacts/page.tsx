'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, qs } from '@/lib/api'
import { summariseCsv, type CsvSummary } from '@/lib/csv'
import { displayName, fmtNum, maskEmail, maskPhone, timeAgo, titleCase } from '@/lib/format'
import { useAction, useDebounced, useLoad } from '@/lib/hooks'
import type { ConsentQuery, Contact, ContactFilter, ContactList, ImportSummary, ListFilter } from '@/lib/types'
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Confirm,
  ConsentBadge,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pager,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui'

// Each chip is one value of ListContactsQueryDTO.consent ('sms' | 'email' | 'any' | 'none').
// The API has no "opted out" filter (optedOutAt is a field, not a query), so there is no such chip.
const FILTERS: { key: ContactFilter; label: string; consent?: ConsentQuery }[] = [
  { key: 'all', label: 'all' },
  { key: 'sms_ok', label: 'SMS ok', consent: 'sms' },
  { key: 'email_ok', label: 'email ok', consent: 'email' },
  { key: 'no_consent', label: 'no consent', consent: 'none' },
]

const consentOf = (f: ContactFilter): ConsentQuery | undefined => FILTERS.find((x) => x.key === f)?.consent

const LIMIT = 50

export default function ContactsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  const [filter, setFilter] = useState<ContactFilter>('all')
  const [page, setPage] = useState(1)
  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [saveListOpen, setSaveListOpen] = useState(false)

  useEffect(() => setPage(1), [q, filter])

  const list = useLoad(
    () => api.list<Contact>(`/contacts${qs({ search: q, consent: consentOf(filter), page, limit: LIMIT })}`),
    [q, filter, page],
  )

  // Chip counts: four tiny queries that only read meta.total.
  const counts = useLoad(async () => {
    const out: Partial<Record<ContactFilter, number>> = {}
    await Promise.all(
      FILTERS.map(async (f) => {
        try {
          const r = await api.list<Contact>(`/contacts${qs({ consent: f.consent, limit: 1 })}`)
          out[f.key] = r.meta?.total ?? (f.key === 'all' ? r.data.length : undefined)
        } catch {
          // leave undefined
        }
      }),
    )
    return out
  }, [list.data])

  const total = list.data?.meta?.total ?? list.data?.data.length ?? 0
  const smsOk = counts.data?.sms_ok

  const refresh = useCallback(() => {
    list.reload()
  }, [list])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={
          <>
            {fmtNum(counts.data?.all ?? total)} people{' '}
            {smsOk !== undefined && <span className="ml-2 text-base font-normal text-ok">{fmtNum(smsOk)} can receive SMS</span>}
          </>
        }
        subtitle="Consent is a column you can see. Someone marked STOP or no consent stays searchable but can never be put in a send."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>Import a CSV</Button>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Add one
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
        <Input placeholder="Search a name, a number, an email…" value={search} onChange={(e) => setSearch(e.target.value)} className="md:max-w-md" aria-label="Search contacts" />
        {total > 0 && (
          <Button onClick={() => setSaveListOpen(true)} className="md:ml-auto">
            Text these {fmtNum(total)} people
          </Button>
        )}
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            {counts.data?.[f.key] !== undefined && <span className="ml-1 opacity-70">· {fmtNum(counts.data[f.key])}</span>}
          </Chip>
        ))}
      </div>

      <div className="rounded-card border border-line bg-card">
        {list.loading && !list.data ? (
          <Loading rows={6} />
        ) : list.error && !list.data ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.data.length === 0 ? (
          <EmptyState
            title={q || filter !== 'all' ? 'Nobody matches that' : 'No contacts yet'}
            body={q || filter !== 'all' ? 'Try a different search or filter.' : 'Import a CSV from your till or your old tool, or add one person by hand.'}
            action={
              !q && filter === 'all' ? (
                <div className="flex gap-2">
                  <Button onClick={() => setImportOpen(true)}>Import a CSV</Button>
                  <Button variant="primary" onClick={() => setAddOpen(true)}>
                    Add one
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th>Tags</Th>
                  <Th>SMS</Th>
                  <Th>Email</Th>
                  <Th>Last message</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((c) => {
                  const stopped = Boolean(c.optedOutAt)
                  return (
                    <tr key={c._id} className={`cursor-pointer hover:bg-greyb/50 ${stopped ? 'opacity-80' : ''}`} onClick={() => setEditing(c)}>
                      <Td className="font-medium">{displayName(c)}</Td>
                      <Td mono>{maskPhone(c.phone)}</Td>
                      <Td className="text-mut">{maskEmail(c.email)}</Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 3).map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                          {(c.tags?.length ?? 0) > 3 && <span className="text-xs text-mut">+{(c.tags?.length ?? 0) - 3}</span>}
                        </span>
                      </Td>
                      <Td>{c.phone ? <ConsentBadge channel="sms" consent={c.smsConsent} optedOut={stopped} /> : <span className="text-mut">—</span>}</Td>
                      <Td>{c.email ? <ConsentBadge channel="email" consent={c.emailConsent} /> : <span className="text-mut">—</span>}</Td>
                      <Td className="text-mut">{timeAgo(c.lastMessagedAt)}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <Pager page={page} totalPages={list.data.meta?.totalPages} total={list.data.meta?.total} noun="people" onPage={setPage} />
          </>
        )}
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={refresh} />
      <ContactModal open={addOpen} contact={null} onClose={() => setAddOpen(false)} onDone={refresh} />
      <ContactModal open={Boolean(editing)} contact={editing} onClose={() => setEditing(null)} onDone={refresh} />
      <SaveListModal
        open={saveListOpen}
        onClose={() => setSaveListOpen(false)}
        count={total}
        filter={{ search: q, filter }}
        onSaved={(l) => router.push(`/campaigns/new?listId=${l._id}`)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Import a CSV                                                        */
/* ------------------------------------------------------------------ */

/** ImportContactsSummaryDTO: { created, updated, skipped, skippedReasons } */
const IMPORT_KEY_LABELS: Record<string, string> = {
  created: 'added',
  updated: 'updated',
  skipped: 'skipped',
}

/** ImportSkipReason in api/src/contacts/contacts.service.ts */
const SKIPPED_REASON_LABELS: Record<string, string> = {
  no_phone_or_email: 'had no usable phone or email',
  invalid_phone: 'had a phone number we could not read',
  invalid_email: 'had an email address we could not read',
  duplicate_in_file: 'were repeated in the file',
  conflicts_with_existing: 'matched two different existing people',
  write_failed: 'could not be saved',
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('')
  const [consentSource, setConsentSource] = useState('')
  const [result, setResult] = useState<ImportSummary | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, error, run, clearError } = useAction()

  // The server records consent for every row when a consent source is given (SMS where there is a
  // phone, email where there is an email), unless the row's own consent column says no.
  const assumed = Boolean(consentSource.trim())
  const summary: CsvSummary | null = useMemo(
    () => (csv.trim() ? summariseCsv(csv, { smsConsent: assumed || undefined, emailConsent: assumed || undefined, consentSource: consentSource.trim() || undefined }) : null),
    [csv, assumed, consentSource],
  )

  const reset = () => {
    setCsv('')
    setResult(null)
    setConsentSource('')
    clearError()
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    f.text().then(setCsv).catch(() => setCsv(''))
  }

  const commit = async () => {
    // ImportContactsInputDTO: { csv, defaultCountryCode?, consentSource?, tags? }
    const r = await run(() =>
      api.post<ImportSummary>('/contacts/import', {
        csv,
        consentSource: consentSource.trim() || undefined,
      }),
    )
    if (r !== undefined) {
      setResult(r && typeof r === 'object' ? r : {})
      onDone()
    }
  }

  const close = () => {
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import a CSV"
      wide
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commit} disabled={busy || !summary || summary.rows === 0}>
              {busy ? 'Importing…' : summary ? `Import ${fmtNum(summary.rows)} ${summary.rows === 1 ? 'person' : 'people'}` : 'Import'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="ok">Import finished.</Notice>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(result)
              .filter((e): e is [string, number] => typeof e[1] === 'number')
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-right font-semibold tabular-nums">{fmtNum(v)}</dt>
                  <dd className="text-mut">{IMPORT_KEY_LABELS[k] ?? titleCase(k).toLowerCase()}</dd>
                </div>
              ))}
          </dl>
          {result.skippedReasons && Object.values(result.skippedReasons).some((n) => n > 0) && (
            <div className="text-sm">
              <div className="mb-1 font-medium text-bad">Rows we could not use</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-mut">
                {Object.entries(result.skippedReasons)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => (
                    <div key={k} className="contents">
                      <dt className="text-right font-semibold tabular-nums">{fmtNum(n)}</dt>
                      <dd>{SKIPPED_REASON_LABELS[k] ?? titleCase(k).toLowerCase()}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
          <p className="text-xs text-mut">Anyone who ever replied STOP stays suppressed, even if this file says otherwise.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Paste the spreadsheet here" hint="Copy the cells from Excel, Numbers or Google Sheets and paste. A header row helps but is not required.">
              <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} placeholder={'name,phone,email,tags,sms_consent\nAsha Thapa,+9779812344412,asha@example.com,regular,yes'} className="font-mono text-xs" />
            </Field>
            <div className="space-y-3">
              <Field label="…or upload a file">
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm text-mut file:mr-3 file:rounded-lg file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-fg" />
              </Field>
              <Field label="Where did these people agree to be contacted?" hint="Recorded on every row as the consent source, e.g. 'shop sign-up sheet, Oct 2026'. Giving a source records consent for everyone in the file (SMS where there is a phone, email where there is an email) unless a row's consent column says no. Only fill it in if you asked them. Rows with no source and no consent column import, but can never be sent to.">
                <Input value={consentSource} onChange={(e) => setConsentSource(e.target.value)} placeholder="e.g. POS checkout opt-in" />
              </Field>
            </div>
          </div>

          {summary && (
            <div className="rounded-lg border border-line bg-bg p-3 text-sm">
              <div className="mb-2 font-semibold">What we found before saving anything</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
                <Stat n={summary.rows} word="rows" />
                <Stat n={summary.withPhone} word="with a phone number" />
                <Stat n={summary.withEmail} word="with an email" />
                <Stat n={summary.withConsent} word="with consent" tone="ok" />
                <Stat n={summary.withoutConsent} word="without consent (saved, never sent to)" tone={summary.withoutConsent ? 'warn' : undefined} />
                <Stat n={summary.withNeither} word="with no way to reach them" tone={summary.withNeither ? 'bad' : undefined} />
                {summary.duplicatePhones > 0 && <Stat n={summary.duplicatePhones} word="repeated phone numbers in the file" tone="warn" />}
              </div>
              <div className="mt-3 text-xs text-mut">
                Columns we understood:{' '}
                {Object.keys(summary.mapped).length ? (
                  Object.entries(summary.mapped).map(([f, col]) => (
                    <span key={f} className="mr-2 inline-block">
                      <span className="font-mono">{col}</span> → {titleCase(f).toLowerCase()}
                    </span>
                  ))
                ) : (
                  <span>no header row, so we guessed from the values</span>
                )}
                {summary.unmappedColumns.length > 0 && (
                  <span>
                    {' '}
                    · ignored: <span className="font-mono">{summary.unmappedColumns.join(', ')}</span>
                  </span>
                )}
              </div>
              {summary.sample.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-mut">
                        <th className="py-1 pr-3 font-medium">Name</th>
                        <th className="py-1 pr-3 font-medium">Phone</th>
                        <th className="py-1 pr-3 font-medium">Email</th>
                        <th className="py-1 pr-3 font-medium">SMS</th>
                        <th className="py-1 pr-3 font-medium">Email ok</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.sample.map((r, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="py-1 pr-3">{r.name || <span className="text-mut">—</span>}</td>
                          <td className="py-1 pr-3 font-mono">{r.phone || <span className="text-mut">—</span>}</td>
                          <td className="py-1 pr-3">{r.email || <span className="text-mut">—</span>}</td>
                          <td className="py-1 pr-3">{r.smsConsent ? 'yes' : 'no consent'}</td>
                          <td className="py-1 pr-3">{r.emailConsent ? 'yes' : 'no consent'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {summary.rows > 5 && <div className="mt-1 text-xs text-mut">…and {fmtNum(summary.rows - 5)} more</div>}
                </div>
              )}
            </div>
          )}
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  )
}

function Stat({ n, word, tone }: { n: number; word: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const c = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : ''
  return (
    <div className={c}>
      <span className="font-semibold tabular-nums">{fmtNum(n)}</span> <span className="text-mut">{word}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Add / edit one person                                               */
/* ------------------------------------------------------------------ */

function ContactModal({ open, contact, onClose, onDone }: { open: boolean; contact: Contact | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [tags, setTags] = useState('')
  const [sms, setSms] = useState(false)
  const [em, setEm] = useState(false)
  const [source, setSource] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { busy, error, run, clearError } = useAction()

  useEffect(() => {
    if (!open) return
    setName(contact?.name?.trim() ?? '')
    setPhone(contact?.phone ?? '')
    setEmail(contact?.email ?? '')
    setTags((contact?.tags ?? []).join(', '))
    setSms(Boolean(contact?.smsConsent))
    setEm(Boolean(contact?.emailConsent))
    setSource(contact?.consentSource ?? '')
    clearError()
  }, [open, contact, clearError])

  const stopped = Boolean(contact?.optedOutAt)

  const save = async () => {
    const body = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim().toLowerCase() || undefined,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      smsConsent: sms,
      emailConsent: em,
      consentSource: source.trim() || undefined,
    }
    const r = await run(() => (contact ? api.patch<Contact>(`/contacts/${contact._id}`, body) : api.post<Contact>('/contacts', body)))
    if (r !== undefined) {
      onDone()
      onClose()
    }
  }

  const remove = async () => {
    if (!contact) return
    const r = await run(() => api.del(`/contacts/${contact._id}`))
    if (r !== undefined) {
      setConfirmDelete(false)
      onDone()
      onClose()
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={contact ? displayName(contact) : 'Add one person'}
        footer={
          <>
            {contact && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy} className="mr-auto">
                Delete
              </Button>
            )}
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={busy || (!phone.trim() && !email.trim())}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {stopped && (
            <Notice tone="bad">
              This person replied STOP{contact?.optedOutAt ? ` ${timeAgo(contact.optedOutAt)}` : ''}. They stay here so you can see their history, but no campaign can ever include them. That cannot be undone from this screen.
            </Notice>
          )}
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha Thapa" autoFocus={!contact} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" hint="With the country code, e.g. +977 98…">
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9779812344412" />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="asha@example.com" />
            </Field>
          </div>
          <Field label="Tags" hint="Separate with commas: regular, wholesale, vip">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <div className="rounded-lg border border-line bg-bg p-3">
            <div className="mb-2 text-sm font-semibold">Consent</div>
            <div className="space-y-2">
              <Checkbox label="They agreed to receive SMS" checked={sms} onChange={(e) => setSms(e.target.checked)} disabled={stopped} />
              <Checkbox label="They agreed to receive email" checked={em} onChange={(e) => setEm(e.target.checked)} />
            </div>
            <Field label="How do you know?" className="mt-3" hint="e.g. 'asked at checkout', 'website form'. Saved with today's date.">
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>
            {contact?.consentAt && <div className="mt-2 text-xs text-mut">Consent recorded {timeAgo(contact.consentAt)}.</div>}
          </div>
          {contact && (
            <div className="text-xs text-mut">
              Last message {timeAgo(contact.lastMessagedAt)}
              {contact.createdAt ? ` · added ${timeAgo(contact.createdAt)}` : ''}
            </div>
          )}
          <InlineError message={error} />
        </div>
      </Modal>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this person?"
        body={
          <>
            <p>
              {displayName(contact)} will be removed from every list. Their past messages stay in campaign reports.
            </p>
            <p className="mt-2 text-mut">If they asked you to stop texting them, do not delete — mark them STOP instead so a future import cannot bring them back.</p>
          </>
        }
        confirmLabel="Delete"
        danger
        busy={busy}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Save the current filter as a list                                   */
/* ------------------------------------------------------------------ */

/** The most people a search is turned into a hand-picked list for. */
const STATIC_LIST_CAP = 2000

function SaveListModal({ open, onClose, count, filter, onSaved }: { open: boolean; onClose: () => void; count: number; filter: { search: string; filter: ContactFilter }; onSaved: (l: ContactList) => void }) {
  const [name, setName] = useState('')
  const { busy, error, run } = useAction()
  const canSend = filter.filter !== 'no_consent'
  // A dynamic list's filter (ListFilterDTO) knows consent and tags, not free text. So a chip alone
  // becomes a living list; a search becomes a hand-picked list of the people it matches right now.
  const living = !filter.search

  const save = async () => {
    const listName = name.trim() || `People matching "${filter.search || filter.filter}"`
    const r = await run(async () => {
      if (living) {
        const f: ListFilter = {}
        if (filter.filter === 'sms_ok') f.smsConsent = true
        if (filter.filter === 'email_ok') f.emailConsent = true
        return api.post<ContactList>('/lists', { name: listName, type: 'dynamic', filter: f })
      }
      const contactIds: string[] = []
      for (let page = 1; contactIds.length < STATIC_LIST_CAP; page++) {
        const r = await api.list<Contact>(`/contacts${qs({ search: filter.search, consent: consentOf(filter.filter), page, limit: 100 })}`)
        contactIds.push(...r.data.map((c) => c._id))
        if (r.data.length < 100 || (r.meta && page >= r.meta.totalPages)) break
      }
      return api.post<ContactList>('/lists', { name: listName, type: 'static', contactIds: contactIds.slice(0, STATIC_LIST_CAP) })
    })
    if (r) onSaved(r)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Text these ${fmtNum(count)} people`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !canSend}>
            {busy ? 'Saving…' : 'Save list and compose'}
          </Button>
        </>
      }
    >
      {canSend ? (
        <div className="space-y-3 text-sm">
          <p>
            {living
              ? 'We will save this filter as a living list and open the composer.'
              : `We will save the ${fmtNum(Math.min(count, STATIC_LIST_CAP))} people this search matches right now as a list and open the composer.${count > STATIC_LIST_CAP ? ` (A search list holds at most ${fmtNum(STATIC_LIST_CAP)} people.)` : ''}`}{' '}
            Anyone in it who has opted out or has no consent is held back automatically, and the composer shows you how many.
          </p>
          <Field label="Name the list">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={filter.search ? `Search: ${filter.search}` : 'Everyone'} autoFocus />
          </Field>
          <InlineError message={error} />
        </div>
      ) : (
        <Notice tone="bad">These people never agreed to be contacted, so they cannot be sent to. Pick a different filter.</Notice>
      )}
    </Modal>
  )
}
