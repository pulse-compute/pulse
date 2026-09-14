# @pulse-compute/wasm-schema-json

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse schema compiler and runtime maintainers.<br>
> **Install directly:** No for application projects; declare schemas in the selected .pulse/config.ts profile.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal schema compiler interface synchronized with this release set.<br>
> **npm:** [`@pulse-compute/wasm-schema-json`](https://www.npmjs.com/package/@pulse-compute/wasm-schema-json)<br>
> **Canonical replacement:** `schemas in .pulse/config.ts through the Pulse project workflow`<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.4` package policy.
<!-- pulse-package-status:end -->

JSON schema compiler, canonical codec, registry, sidecar, and body-policy implementation for Pulse.

Application projects declare schemas in `pulse.config.*`; they do not install or import this package directly.

## Responsibilities

- compile explicitly declared TypeScript schema roots;
- build the canonical schema registry and stable schema IDs;
- generate request decode and response encode codecs;
- enforce content-type and maximum-body policies;
- generate and validate schema sidecar/compiler artifacts;
- provide the generic parser implementation used by maintained internal tracks.

## Boundaries

- The CLI owns project configuration and user-facing diagnostics.
- Shared contracts own schema protocol vocabulary.
- The canonical handler names schemas through `ctx.req.json('namespace.Type')` and `ctx.json(value, { schema: 'namespace.Type' })`.
- Pulse does not scan arbitrary project types or materialize provider-specific body objects.

The exported compiler modules are synchronized implementation interfaces without an application-author compatibility promise.

See [Explicit JSON schemas](https://pulsecompute.io/v1.0.0-beta.4/guides/json-schemas/), [Project configuration](https://pulsecompute.io/v1.0.0-beta.4/reference/project-config/#json-schema-policy), and [Implementation packages](https://pulsecompute.io/v1.0.0-beta.4/packages/implementation-packages/).
