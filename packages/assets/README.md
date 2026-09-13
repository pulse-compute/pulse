# @pulse-compute/assets

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications using JavaScript asset middleware or the package-owned lowerable asset lookup capability.<br>
> **Install directly:** Yes, only when the application uses the assets capability.<br>
> **Supported entry points:** `@pulse-compute/assets`<br>
> **Stability:** The package root is the supported JavaScript API and canonical Native authoring surface; /pulsewasm remains a compatibility subpath, while manifest/compiler subpaths are toolchain integration.<br>
> **npm:** [`@pulse-compute/assets`](https://www.npmjs.com/package/@pulse-compute/assets)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.2/packages/assets/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.2` package policy.
<!-- pulse-package-status:end -->

The normal package root is the supported JavaScript API and canonical Native authoring surface:

```ts
import { assets } from '@pulse-compute/assets'

const found = await assets.lookup(ctx, 'public', '/app.js', { method: 'GET' })
return assets.respond(found)
```

`assets.lookup()` is a request-bound package effect owned by the internal `pulse.assets` contract and may be directly awaited or included in `ctx.parallel({ ... })`. JavaScript executes the actual package implementation; supported Native calls are recognized by the trusted package compiler and lowered to `assets.lookup`.

The same root exports `createAssets`, `AssetManager`, `AssetBucket`, and `signSigV4` for direct JavaScript local, hosted, and S3-compatible asset middleware. Hosted and bucket modes preserve upstream Web response streams. Local mode follows the restored reference behavior; a broader resource-bound policy belongs at the shared core request/response boundary.

`@pulse-compute/assets/pulsewasm` remains a compatibility-only lowerable
facade. Direct JavaScript execution of that subpath throws
`PulseWasmAssetsLoweringError`; applications should use the normal package
root. Manifest and compiler exports are toolchain integration. Migration
guidance is published at
<https://pulsecompute.io/v1.0.0-beta.2/guides/compatibility-imports/>.
