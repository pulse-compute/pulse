import type { PulseExecutionContext, PulseFetchOperation } from '@pulse-compute/runtime'

declare const ctx: PulseExecutionContext
const url = 'https://example.invalid/items/123'

const patch: PulseFetchOperation = ctx.fetch(url, {
  method: 'PATCH', json: { enabled: false }, schema: 'example.ItemUpdate',
  headers: [['x-request-id', 'patch']], timeoutMs: 1000,
})
const put: PulseFetchOperation = ctx.fetch(url, {
  method: 'PUT', json: { enabled: true }, schema: 'example.ItemUpdate',
  headers: { 'x-request-id': 'put' }, timeoutMs: 1000,
})
const projected: Promise<string> = patch.text()
const json: Promise<{ enabled: boolean }> = put.json('example.ItemUpdate')
void projected
void json
ctx.fetch(url)
for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH'] as const) ctx.fetch(url, { method })
for (const method of ['POST', 'PUT', 'PATCH'] as const) {
  ctx.fetch(url, { method, body: 'text' })
  ctx.fetch(url, { method, json: { enabled: true }, schema: 'example.ItemUpdate' })
}
// @ts-expect-error arbitrary outgoing methods remain unsupported
ctx.fetch(url, { method: 'DELETE' })
// @ts-expect-error the fix does not add OPTIONS
ctx.fetch(url, { method: 'OPTIONS' })
// @ts-expect-error body and json remain mutually exclusive
ctx.fetch(url, { method: 'PATCH', body: 'text', json: { enabled: true } })
// @ts-expect-error schema requires json
ctx.fetch(url, { method: 'PUT', body: 'text', schema: 'example.ItemUpdate' })
// @ts-expect-error binary bodies remain unsupported
ctx.fetch(url, { method: 'PUT', body: new Uint8Array([1]) })
// @ts-expect-error timeout remains numeric
ctx.fetch(url, { method: 'PATCH', timeoutMs: '1000' })
// @ts-expect-error header values remain strings
ctx.fetch(url, { method: 'PUT', headers: { 'x-value': 1 } })

// Collected outcomes preserve the selected payload and discriminate failures.
import type { PulseFetchOutcome, PulseOpaqueResponse, PulseFetchInit } from '@pulse-compute/runtime'
const collected: Promise<PulseFetchOutcome<string>> = ctx.fetch(url, { errors: 'collect' }).text()
const collectedJson: Promise<PulseFetchOutcome<{ enabled: boolean }>> = ctx.fetch(url, { errors: 'collect' }).json<{ enabled: boolean }>('example.ItemUpdate')
const rawCollected: Promise<PulseFetchOutcome<PulseOpaqueResponse>> = ctx.fetch(url, { errors: 'collect' })
declare const maybeCollect: PulseFetchInit
const conditional: Promise<PulseOpaqueResponse | PulseFetchOutcome<PulseOpaqueResponse>> = ctx.fetch(url, maybeCollect)
async function outcomes() {
  const result = await ctx.fetch(url, { errors: 'collect' }).text()
  if (result.status === 'fulfilled') {
    const value: string = result.value
    void value
    // @ts-expect-error fulfilled outcomes have no error
    result.error
  } else {
    const code: 'PULSE_FETCH_NETWORK' | 'PULSE_FETCH_TIMEOUT' = result.error.code
    void code
    // @ts-expect-error failed outcomes have no payload
    result.value
  }
  const group = await ctx.parallel({ plain: ctx.fetch(url).text(), collected: ctx.fetch(url, { errors: 'collect' }).text() })
  const plain: string = group.plain
  const wrapped: PulseFetchOutcome<string> = group.collected
  void [plain, wrapped]
}
// @ts-expect-error unsupported policy is rejected
ctx.fetch(url, { errors: 'ignore' })
// @ts-expect-error selected text is wrapped
const unwrapped: Promise<string> = ctx.fetch(url, { errors: 'collect' }).text()
void [collected, collectedJson, rawCollected, conditional, outcomes, unwrapped]

import type { PulseTimedFetchOutcome } from '@pulse-compute/runtime'
const timed: Promise<{ readonly status: 'fulfilled'; readonly value: string; readonly elapsedMs: number | null }> = ctx.fetch(url, { timing: true }).text()
const timedCollected: Promise<PulseTimedFetchOutcome<string>> = ctx.fetch(url, { timing: true, errors: 'collect' }).text()
const untimed: Promise<string> = ctx.fetch(url, { timing: false }).text()
// @ts-expect-error timing is boolean
ctx.fetch(url, { timing: 'true' })
// @ts-expect-error timing alone still wraps success
const timedPlain: Promise<string> = ctx.fetch(url, { timing: true }).text()
void [timed, timedCollected, untimed, timedPlain]
