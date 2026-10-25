'use client'

import { countSms } from '@/lib/sms'

/** Live "118 characters · 1 SMS" line under an SMS body field. */
export function SmsCounter({ text, extra }: { text: string; extra?: string }) {
  const c = countSms(text)
  const segs = c.segments === 1 ? '1 SMS' : `${c.segments} SMS`
  const tone = c.segments > 1 ? 'text-warn' : 'text-mut'
  return (
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${tone}`}>
      <span className="tabular-nums">
        {c.characters} {c.characters === 1 ? 'character' : 'characters'}
      </span>
      <span>·</span>
      <span className="font-medium">{segs}</span>
      {c.segments > 0 && c.segments <= 1 && (
        <>
          <span>·</span>
          <span>{c.remainingInSegment} left before it becomes 2</span>
        </>
      )}
      {c.encoding === 'Unicode' && (
        <>
          <span>·</span>
          <span className="text-warn">{c.hasEmoji ? 'an emoji dropped the limit to 70 per SMS' : 'special characters drop the limit to 70 per SMS'}</span>
        </>
      )}
      {c.segments > 1 && (
        <>
          <span>·</span>
          <span>each person gets {c.segments} texts, so sending takes {c.segments}× longer</span>
        </>
      )}
      {extra && (
        <>
          <span>·</span>
          <span>{extra}</span>
        </>
      )}
    </div>
  )
}
