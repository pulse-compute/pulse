# `@pulse-compute/assets`

`@pulse-compute/assets` is the supported application entry point for both direct JavaScript execution and supported Native lowering.

The package root exposes the complete JavaScript asset implementation—local files, hosted origins, S3-compatible buckets, and SigV4 support—plus the narrow request-bound surface that Native compilation can recognize.

## Install

```bash
npm install @pulse-compute/assets@1.0.0-beta.5
```

## Portable lookup surface

```ts
import { assets } from '@pulse-compute/assets'

const found = await assets.lookup(ctx, 'public', '/app.js', {
  method: 'GET',
  cacheControl: 'public, max-age=60',
})

return assets.respond(found)
```

The portable surface is:

- `assets.lookup(ctx, store, key, options?)` — a request-bound package effect that may be directly awaited or used inside `ctx.parallel({ ... })`;
- `assets.respond(response, options?)` — a pure response-adoption and decoration helper;
- equivalent named exports `lookup` and `respond`.

JavaScript executes the real package implementation through the request-owned package-effect bridge. Native compilation recognizes the same package-root call and emits the canonical `assets.lookup` package effect. Supported Native argument restrictions are enforced by package lowering eligibility and diagnostics rather than by changing the JavaScript API.

## JavaScript middleware

The package root also exports:

```ts
import {
  AssetManager,
  AssetBucket,
  createAssets,
  signSigV4,
} from '@pulse-compute/assets'
```

`createAssets()` supports local, hosted, and bucket-backed middleware. Hosted and bucket responses adopt upstream Web streams directly, preserving status, headers, and host-owned response-body ownership. Local assets currently follow the restored implementation and materialize the selected file. Broader request/response resource limits belong at a shared core ownership boundary rather than in an Assets-only policy.

## Opt-in embedded blobs (AST-02B)

```ts
import { createAssets, createEmbeddedManifest } from '@pulse-compute/assets'

const manifest = await createEmbeddedManifest([
  { path: '/logo.bin', bytes: new Uint8Array([0, 255, 1]),
    contentType: 'application/octet-stream' },
])
app.use('/static', createAssets({ mode: 'embedded', manifest }))
```

This is a direct JavaScript middleware surface, tested through Node Pulse
execution and isolated installed imports. It does not embed data into Native
Wasm, add a compiler intrinsic, scan directories or fetch remote files. Supply
explicit bytes from application code or a build script. Native artifact
embedding is a separate increment; `assets.lookup` keeps its existing provider
binding semantics.

`createEmbeddedManifest` returns a JSON-serializable `pulse.embedded-assets.v1`
manifest with canonical base64 bytes, per-file SHA-256, total length and a
content identity. Paths are sorted with locale-independent string comparison.
The identity is SHA-256 of the UTF-8 JSON tuple `[version, records]`, with each
record `[path, contentType, byteLength, sha256]`. Input order does not affect it;
changing paths, media types or bytes does. Bytes are copied before hashing;
constructing middleware snapshots serialized input, then validates all hashes
and identity before serving any file. This detects corruption; it does not
authenticate the manifest's author.

Hard inclusive limits are 256 files, 256 KiB per file, 1 MiB total decoded bytes,
1024 UTF-8 bytes per path and 128 ASCII characters per content type. Empty files
and empty manifests are allowed. Base64 storage adds its normal encoding
overhead. Paths must start with `/`; duplicates, empty/dot segments, backslashes,
percent signs, queries, fragments, controls and malformed Unicode are rejected.
Requests decode the scoped path once; encoded slashes, backslashes and residual
percent escapes are rejected. Lookup can access only admitted manifest entries.

GET returns exact bytes and HEAD returns identical representation metadata
without a body. ETag derives from the full file hash. One If-None-Match tag
(weak comparison) or `*` can produce 304 before range processing. GET supports
one closed `bytes=start-end` range, clips the end, and returns 206 or 416 with
Content-Range. HEAD ignores Range. If-Range permits a range only on an exact
strong ETag match; other values select the full response. Unsupported/malformed
range forms and validator lists return 400. Date conditionals and If-Match
are outside this subset. Missing files and unsupported methods retain the
existing middleware pass-through policy; cache options still apply.

A partial response's ETag identifies the full representation; it is **not** a
checksum assertion over the returned slice and cannot establish whole-object
integrity from that slice. Each response copies only its selected bytes, so
consumers cannot mutate retained asset content.

## S3 protocol ownership and compatibility

S3 owns shared RFC3986 key encoding and SigV4 canonicalization, signing-key
derivation and authorization. Assets depends on the matching S3 package and
adapts its existing `signSigV4` and `encodeS3Key` exports to that implementation.
Assets retains lookup, path-style/virtual-host bucket URL policy, middleware,
HTTP conditionals, caching and response-body ownership. Providers retain
credential resolution and transport for governed operations.

The direct JavaScript helpers retain their existing behavior: string/promise/
callback credentials, sequential credential resolution, `us-east-1` and `s3`
defaults, custom service/region, session tokens, `UNSIGNED-PAYLOAD` by default,
explicit payload hashes, and `AssetBucketSignError` with the original cause.
The custom bucket signer and injected fetch hooks remain available. These
compatibility helpers use Web Crypto; they do not grant Native lowering authority
or inherit the stricter admission rules of bounded S3 effects. `encodeS3Key`
continues to encode segments without imposing the S3 effect's key restrictions.

The first-party `@pulse-compute/s3/signing` export is a typed integration bridge,
not an application entry point. No listing, binary-read, embedded-blob or new
conditional/range capability is introduced by this ownership cleanup.

## Response ownership

A direct asset response preserves:

- status, including range responses such as `206`;
- repeated and ordinary headers;
- `GET` and `HEAD` behavior;
- upstream Web stream identity for hosted and bucket modes;
- cancellation of discarded upstream bodies during pass-through or bodyless responses.

The portable response is opaque to Native application code. Structured request-body and fetched-response projection bounds remain separate core contracts.

## Compatibility subpath

`@pulse-compute/assets/pulsewasm` remains a compatibility subpath. New
applications should import from `@pulse-compute/assets`. The manifest and
compiler subpaths are trusted toolchain integration, not application APIs. See
[Compatibility imports and migration](../guides/compatibility-imports.md).

## Package-owned files

The release tarball includes:

- the built JavaScript implementation and type declarations;
- `pulse.package.json` product and target metadata;
- `pulsewasm.manifest.cjs` trusted package-lowering identity;
- `pulsewasm.compiler.cjs` package-specific static validation and lowering;
- `as/index.as.ts` sidecar declarations used by compiled-Wasm integration.

See [Package-owned lowering](../concepts/package-owned-lowering.md) and [Add a first-party package-owned lowerer](../contributing/adding-first-party-lowerer.md).

## Related documentation

- [Compilation and lowering](../concepts/compilation-and-lowering.md)
- [Structured and opaque bodies](../concepts/bodies.md)
- [Package support policy](./README.md)
- [Implementation packages](./implementation-packages.md)
