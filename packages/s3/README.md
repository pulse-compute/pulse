# @pulse-compute/s3

O2 provides bounded, exact-key `s3.head(ctx, binding, key)` and
`s3.getText(ctx, binding, key)` effects for Node Native and Fastly Native.
Await a read into a local variable or use it directly in keyed `ctx.parallel`.
The binding is a literal logical name; the key can be a runtime string.

Providers own fixed HTTPS origin, bucket, region, named credential references,
deadline and transport. Fastly additionally requires a named static backend.
Native Crypto selection must include `SHA-256` and `HMAC-SHA256`. Crypto owns the
digest and MAC primitives; S3 owns signing and exact object semantics.

Put mappings under `<profile>.node.bindings.s3` or
`<profile>.fastly.bindings.s3`. A logical `objects` entry has these fields:

| Field | Value |
| --- | --- |
| `endpoint` | Fixed HTTPS origin, for example `https://objects.example.invalid` |
| `bucket`, `region` | Explicit bucket and signing region |
| `accessKeyIdSecret`, `secretAccessKeySecret` | Named provider secret references |
| `sessionTokenSecret` | Optional named session-token reference |
| `maxTextBytes` | 1–32768; default 32768 |
| `timeoutMs` | 1–30000; default 10000 |
| `backend` | Fastly-only named static backend |

The profile declares `crypto: ['SHA-256', 'HMAC-SHA256']`. A read looks like
`const object = await s3.getText(ctx, 'objects', key)` inside a handler.

GET accepts at most 32,768 raw bytes and strictly decodes UTF-8, preserving a BOM.
It returns the raw-byte SHA-256 digest and byte length with optional opaque ETag
and content type. HEAD requires a safe integer Content-Length but does not read a
body. A 404 returns `not-found`; other failures return a bounded reason and an
HTTP status when observed. Redirects, compression, retries and caching are disabled.

This package is private during implementation. JavaScript realization, PUT,
Assets alignment and release/support promotion are reserved for later phases.
