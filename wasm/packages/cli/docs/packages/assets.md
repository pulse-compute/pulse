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
