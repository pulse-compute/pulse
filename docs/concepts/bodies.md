# Structured and opaque bodies

Application-owned JSON strings can be decoded synchronously with
`ctx.decodeJson<T>(text, 'schema.id')`. The registered schema and UTF-8 size
limit apply without fetching the body again. Keep the original string for
byte hashes and retries; a decoded value is a detached schema projection.
See [application text decoding](../guides/json-schemas.md#decode-application-owned-text).

Pulse distinguishes bodies that application code may inspect from bodies that must remain host-owned. That distinction is part of the provider-neutral contract and is visible in types, compiler metadata, tests, and diagnostics.

A useful rule is:

> **Inspect it as a bounded structured value, or pass it through as an opaque response. Do not silently switch between the two.**

## Ownership transitions

All network body bytes begin under host or provider ownership. A supported
Pulse operation either converts them once into bounded request-owned data or
preserves an opaque host-owned handle. Ownership never moves through a provider
SDK object in userland.

| Boundary | Owner before | Application operation | Owner after |
|---|---|---|---|
| Incoming request text/JSON | Request host owns body bytes | `ctx.req.text()` or `ctx.req.json()` | Current request owns the bounded structured value and read cache. |
| Fetched response text/JSON | Provider adapter owns response bytes | `.text()` or `.json()` on the fetch operation | Current request owns the bounded structured projection. |
| Outbound fetch JSON | Application owns a supported structured value | `ctx.fetch(url, { json, schema })` | Pulse encodes the semantic value; the provider owns dispatched body bytes. |
| Application-owned JSON text | Application owns a structured value | `ctx.encodeJson(value, 'schema.id')` | Application owns detached schema-encoded text within `schemas.maxBytes`. |
| Application text/JSON response | Application owns a supported structured value | `ctx.text()`, `ctx.json()`, or `ctx.response()` | Pulse returns a terminal result; the provider owns response realization. |
| Opaque fetch or package response | Provider owns the body handle | Return the response directly | Provider retains ownership through terminal pass-through. |

Request-owned values and caches end with that request. They cannot be retained
for background work. Provider-owned opaque handles stay opaque: they cannot be converted into a structured body. Structured values cannot be promoted into
a userland stream.

## Structured request bodies

`ctx.req.text()` and `ctx.req.json()` read a bounded request body. JSON can be decoded generically or against an explicitly compiled schema. Repeated schema reads are deterministic within one request.

On Node Native, Node JavaScript and Fastly Native, request text is strict UTF-8.
The original encoded-byte limit is enforced before decoding. Malformed,
truncated, overlong, surrogate and out-of-range encodings fail with
`PULSE_REQUEST_BODY_INVALID_UTF8` before text reaches the application. Valid
replacement characters, a leading U+FEFF, and scalars split across transport
chunks are preserved without normalization. An application error handler may
map this request-data failure to its own bounded 400 response. Without that
handler, Node JavaScript retains its exhausted-error-lane 500 response; the
Native HTTP boundaries reject malformed request text with 400. Transport size
failures remain 413. A schema projection does not establish rejection of
duplicate or unknown properties; that validation policy remains application-owned.

The schema example decodes one body twice and proves that the request-local decoded value is reused:

<!-- pulse-doc-source: examples/02-request-schema/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'
import type { CreateUserInput, CreateUserOutput } from './schemas.js'

const app = new Pulse({ auto: true })

app.post('/users', async (ctx) => {
  const first = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const second = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const output: CreateUserOutput = {
    id: 7,
    name: first.name,
    active: first.active,
    sameReference: first === second,
  }
  return ctx.json(output, { status: 201, schema: 'app.CreateUserOutput' })
})

export default app
```
<!-- /pulse-doc-source -->

```bash
pulse test examples/02-request-schema --case valid-user --json
```

Structured body limits are configured through `schemas.maxBytes`, `dev.maxBodyBytes`, or a test case’s `maxBodyBytes`, depending on the read path. Oversized or invalid input fails before unbounded materialization with diagnostics such as:

- [`PULSE_REQUEST_BODY_TOO_LARGE`](../reference/diagnostics.md#pulse-request-body-too-large);
- [`PULSE_BODY_TOO_LARGE`](../reference/diagnostics.md#pulse-body-too-large);
- [`PULSE_BODY_DECODE`](../reference/diagnostics.md#pulse-body-decode);
- [`PULSE_SCHEMA_DECODE`](../reference/diagnostics.md#pulse-schema-decode).

A successful schema decode returns a normalized, deeply immutable value.
Repeated request reads with the same schema ID reuse that request-local decoded
value. Generic JSON is also bounded, but it does not gain a typed schema
contract.

## Structured fetch responses

A fetch response can be inspected through normalized status, headers, `text()`, and `json<T>()`. Once application code asks for text or JSON, the body is treated as a bounded structured value governed by decoding and size policy.

```ts
const user = await ctx.fetch('https://api.example.test/user').json<{ id: number; name: string }>()
return ctx.json({ found: true, user })
```

The application receives portable data, not a provider SDK response object.

Schema-bound fetched JSON uses the same codec and content-type policy as
schema-bound request JSON. A read consumes the response into a structured
projection for the current request; it does not expose a reusable provider
stream.

## Opaque response pass-through

Some responses should cross Pulse without being copied, decoded, or exposed to userland—archives, media, streaming responses, and provider-owned hold responses are examples. Return the fetch response directly:

<!-- pulse-doc-source: examples/07-opaque-proxy/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/archive', async (ctx) => {
  return ctx.fetch('https://assets.example.com/archive.bin')
})

export default app
```
<!-- /pulse-doc-source -->

<!-- pulse-doc-run {"args":["inspect","examples/07-opaque-proxy","--json"],"display":"pulse inspect examples/07-opaque-proxy --json"} -->
```bash
pulse inspect examples/07-opaque-proxy --json
```
```json
{
  "status": "ok",
  "provider": {
    "id": "fastly"
  },
  "compiler": {
    "effectCount": 1,
    "continuationCount": 1,
    "opaqueReturnCount": 1,
    "providerLowering": {
      "requirements": [
        "fetch",
        "opaque.pass-through"
      ]
    }
  }
}
```

Opaque pass-through preserves host ownership. Pulse may carry status and headers needed to complete the response, but application code cannot inspect chunks, decode the body, concatenate it, or retain it beyond the request lifecycle.

Attempting to inspect an opaque body fails with [`PULSE_OPAQUE_BODY_INSPECTION`](../reference/diagnostics.md#pulse-opaque-body-inspection). A missing or already-consumed structured body can fail with [`PULSE_BODY_UNAVAILABLE`](../reference/diagnostics.md#pulse-body-unavailable).

## Why the distinction matters

The two body classes have different guarantees:

| Property | Structured | Opaque |
|---|---:|---:|
| Application can read text/JSON | Yes, within limits | No |
| Application can construct a replacement body | Yes, from supported values | No |
| Provider object enters userland | No | No |
| Body may remain host-owned | No | Yes |
| Suitable for binary/stream pass-through | No | Yes |
| Userland chunk iteration or transform | No | No |

Pulse does not infer that a body is safe to inspect merely because one provider could expose it. The same canonical source must retain equivalent meaning across supported providers.

## Schema encoding

`ctx.encodeJson(value, 'namespace.Type')` exposes schema encoding as bounded
application-owned text, before a response or storage effect. It always requires
a literal registered schema ID. The returned UTF-8 text is limited by
`schemas.maxBytes`; invalid or oversized output fails before subsequent writes.
Keep those exact bytes for upload and verification. See
[application-owned encoding](../guides/json-schemas.md#encode-application-owned-text)
for determinism and fingerprint boundaries.

`ctx.json(value, { schema: 'namespace.Type' })` validates and encodes a structured response against the compiled schema contract. Schema identifiers must be static and declared in project configuration. Failures use [`PULSE_SCHEMA_ENCODE`](../reference/diagnostics.md#pulse-schema-encode) or [`PULSE_RESPONSE_ENCODE`](../reference/diagnostics.md#pulse-response-encode).

`ctx.fetch(url, { json: value, schema: 'namespace.Type' })` applies the same
semantic encoding boundary to an outbound request. Pulse encodes the value
before provider dispatch; application code never receives the provider request
body object.

See [Explicit JSON schemas](../guides/json-schemas.md) for the exact request,
fetch, response, strict-mode, and response-case forms.

## GRIP hold responses are opaque

A package-owned `grip.hold(...)` operation returns an opaque response contract. The provider owns the hold/stream realization; canonical handler code may return it but may not inspect or transform its body. This is the same body boundary used by direct fetch pass-through.

## Not supported in the Beta

The public contract does not include:

- arbitrary binary body inspection;
- userland stream readers or writers;
- chunk iteration or transforms;
- buffering an opaque response into structured memory;
- provider-specific response objects;
- background consumption after the request completes.

These exclusions are listed in the
[Beta scope](../preview-scope.md).

## Related documentation

- [Canonical API](../../API.md)
- [Explicit JSON schemas](../guides/json-schemas.md)
- [Fetching and composing data](../guides/fetching-and-composition.md)
- [Effects and continuations](./effects-and-continuations.md)
- [Project configuration](../reference/project-config.md)
