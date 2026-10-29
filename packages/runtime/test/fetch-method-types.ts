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
