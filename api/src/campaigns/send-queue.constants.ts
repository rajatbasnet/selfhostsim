/** Name of the Bull queue that carries one job per Send row. */
export const SENDLINE_SENDS_QUEUE = 'sendline-sends'

/** Payload of every job on the queue. Kept tiny; the Send row is the truth. */
export interface SendJobData {
  sendId: string
  campaignId?: string
}

/** A send is attempted this many times in total before it is left FAILED. */
export const MAX_SEND_ATTEMPTS = 2

/** Pause between the first failure and the retry. */
export const SEND_RETRY_DELAY_MS = 15_000

/** Processor concurrency. One at a time: pacing is the point of this queue. */
export const SEND_DISPATCH_CONCURRENCY = 1
