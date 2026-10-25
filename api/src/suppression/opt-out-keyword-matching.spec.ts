import { OPT_OUT_KEYWORDS } from '../sendline/sendline.enums'
import {
  containsOptOutKeyword,
  isOptInMessage,
  isOptOutMessage,
  normalizeMessageBody,
} from './opt-out-keyword-matching'

describe('opt-out keyword matching', () => {
  describe('isOptOutMessage', () => {
    it.each([
      'STOP',
      'stop',
      '  Stop.  ',
      'STOP!',
      'stopall',
      'UNSUBSCRIBE',
      'opt-out',
      'optout',
      'quit',
      'END',
      'Cancel',
    ])('matches the bare keyword %j', (body) => {
      expect(isOptOutMessage(body)).toBe(true)
    })

    it('matches every keyword in the shared OPT_OUT_KEYWORDS list', () => {
      for (const keyword of OPT_OUT_KEYWORDS) {
        expect(isOptOutMessage(keyword)).toBe(true)
        expect(isOptOutMessage(keyword.toUpperCase())).toBe(true)
      }
    })

    it.each([
      ['"STOP"', 'wrapped in quotes'],
      ['...stop...', 'ellipses both sides'],
      ['STOP!!!', 'repeated punctuation'],
      ['“Stop”', 'smart quotes'],
      ['\tstop\n', 'tabs and newlines'],
      [' stop ', 'non-breaking spaces'],
      ['(stop)', 'brackets'],
      ['-stop-', 'dashes'],
    ])('tolerates surrounding punctuation: %j (%s)', (body) => {
      expect(isOptOutMessage(body)).toBe(true)
    })

    it.each([
      ['opt out', 'space instead of hyphen'],
      ['OPT  OUT', 'multiple internal spaces'],
      ['opt - out', 'spaced hyphen'],
      ['stop all', 'stopall with a space'],
      ['Stop All', 'stopall with nbsp'],
    ])('treats separator variants as the same keyword: %j (%s)', (body) => {
      expect(isOptOutMessage(body)).toBe(true)
    })

    it('folds full-width letters (NFKC)', () => {
      expect(isOptOutMessage('ＳＴＯＰ')).toBe(true)
    })

    it.each([
      'stop by tomorrow',
      "please don't stop",
      'nonstop',
      'stopping',
      'unstoppable',
      'stop sending me nothing',
      'cancel my order',
      'the end',
      'end of story',
      'quit playing',
      'can you stop?',
      'STOP STOP',
    ])('does NOT match when the keyword is part of a sentence: %j', (body) => {
      expect(isOptOutMessage(body)).toBe(false)
    })

    /**
     * Design decision: natural-language opt-outs are NOT auto-matched.
     *
     * "I want to stop receiving these" is clearly an opt-out to a human, but a
     * matcher that catches it also catches "please don't stop the weekend
     * deals". We keep the automated path strictly whole-message so it has
     * zero false positives, and route everything else to the inbox where
     * `containsOptOutKeyword` flags it for a person to act on. See the
     * module comment in opt-out-keyword-matching.ts.
     */
    it('does NOT auto-match a natural-language opt-out, but flags it for review', () => {
      const body = 'I want to stop receiving these'
      expect(isOptOutMessage(body)).toBe(false)
      expect(containsOptOutKeyword(body)).toBe(true)
    })

    it.each([null, undefined, '', '   ', '!!!', '...', 123, {}, []])(
      'returns false for empty or non-string input %p',
      (body) => {
        expect(isOptOutMessage(body as any)).toBe(false)
      },
    )

    it('does not match opt-in keywords', () => {
      expect(isOptOutMessage('START')).toBe(false)
      expect(isOptOutMessage('unstop')).toBe(false)
      expect(isOptOutMessage('yes')).toBe(false)
    })

    it('never matches a keyword that is merely a prefix or suffix', () => {
      expect(isOptOutMessage('stops')).toBe(false)
      expect(isOptOutMessage('astop')).toBe(false)
      expect(isOptOutMessage('unsubscribed')).toBe(false)
      expect(isOptOutMessage('ending')).toBe(false)
    })
  })

  describe('isOptInMessage', () => {
    it.each([
      'START',
      'start',
      ' Start. ',
      'UNSTOP',
      'unstop!',
      'YES',
      'yes',
      'Yes.',
    ])('matches %j', (body) => {
      expect(isOptInMessage(body)).toBe(true)
    })

    it.each([
      'start sending me stuff',
      'yes please',
      'restart',
      'yesterday',
      'STOP',
      '',
      null,
      undefined,
    ])('does not match %j', (body) => {
      expect(isOptInMessage(body as any)).toBe(false)
    })

    it('is mutually exclusive with isOptOutMessage for every keyword', () => {
      for (const keyword of OPT_OUT_KEYWORDS) {
        expect(isOptInMessage(keyword)).toBe(false)
      }
      for (const keyword of ['start', 'unstop', 'yes']) {
        expect(isOptOutMessage(keyword)).toBe(false)
      }
    })
  })

  describe('containsOptOutKeyword', () => {
    it('flags sentences that contain a standalone opt-out word', () => {
      expect(containsOptOutKeyword('please unsubscribe me')).toBe(true)
      expect(containsOptOutKeyword('I want to opt out now')).toBe(true)
      expect(containsOptOutKeyword('can you stop?')).toBe(true)
    })

    it('does not flag words that merely contain a keyword', () => {
      expect(containsOptOutKeyword('nonstop fun')).toBe(false)
      expect(containsOptOutKeyword('unstoppable')).toBe(false)
      expect(containsOptOutKeyword('the weekend was great')).toBe(false)
    })

    it('handles empty input', () => {
      expect(containsOptOutKeyword('')).toBe(false)
      expect(containsOptOutKeyword(null as any)).toBe(false)
    })
  })

  describe('normalizeMessageBody', () => {
    it('lowercases, trims, strips edge punctuation and collapses whitespace', () => {
      expect(normalizeMessageBody('  "Hello   There!"  ')).toBe('hello there')
    })

    it('returns an empty string for non-strings', () => {
      expect(normalizeMessageBody(undefined)).toBe('')
      expect(normalizeMessageBody(42)).toBe('')
    })
  })
})
