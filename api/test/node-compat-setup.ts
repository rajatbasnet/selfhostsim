/**
 * Node >= 22 removed `buffer.SlowBuffer`.
 *
 * `jsonwebtoken` -> `jws` -> `jwa` -> `buffer-equal-constant-time@1.0.1` reads
 * `SlowBuffer.prototype` at module load, so on a modern Node that package
 * throws `TypeError: Cannot read properties of undefined (reading 'prototype')`
 * and every suite that touches @nestjs/jwt fails before a single test runs.
 *
 * This is upstream's problem and there is no fixed release to upgrade to:
 * current `jsonwebtoken` still resolves the same transitive version. So we
 * restore the alias before anything loads it. `SlowBuffer` was only ever a
 * non-pooled Buffer and the sole use here is a prototype lookup, so aliasing
 * it to `Buffer` is behaviourally correct.
 *
 * Delete this the day `buffer-equal-constant-time` ships a fix.
 */
import * as buffer from 'buffer'

const compat = buffer as unknown as { SlowBuffer?: unknown }

if (typeof compat.SlowBuffer === 'undefined') {
  compat.SlowBuffer = Buffer
}
