# Changelog

Pulse follows semantic versioning for public releases. The repository begins its public history with the `1.0.0-beta.1` prerelease.

## Unreleased

- Add `ctx.encodeJson(value, 'schema.id')` for schema-validated, bounded JSON text
  before storage or other effects, across JavaScript and Native execution.

## 1.0.0-beta.3 — Beta (2026-09-14)

- Fix CLI storage execution on Node Native, Node JavaScript and the Fastly Native local fixture host, including S3 response streams, bindings and conditional KV.
- Keep the last working Native application available when a development reload fails.
- Allow bounded npm registry propagation time and publish future releases directly under the `latest` npm tag while retaining the Beta release label.

## 1.0.0-beta.2 — Beta (2026-09-13)

This candidate synchronizes the 19-package release catalog and prepares the
next npm `beta` release:

- adds bounded S3-compatible object storage in `@pulse-compute/s3`, backed by
  the Crypto hashing and signing primitives; the Assets contract stays intact;
- adds conditional KV operations and opaque generation tokens, with explicit
  conflict handling and no non-atomic emulation;
- propagates explicit JavaScript targets through project analysis, retaining
  resolved static third-party imports and ordinary awaited calls while
  checking Native eligibility independently;
- clarifies maintainer ownership, target boundaries, evidence requirements,
  and human release authority;
- links public and internal package listings to npm and preserves the exact
  published beta.1 documentation snapshot alongside the beta.2 documentation.

Conditional KV acceptance remains gated separately from the aggregate seal:
Viceroy 0.21.0 creates a missing key for an existing-generation CAS, contrary to
the required conflict behavior, and deployed Pulse cross-location acceptance
is still pending. The standalone live Fastly probe confirms missing-key
rejection but does not satisfy those Pulse acceptance gates. See
[`wasm/test/kv/K4.md`](https://github.com/pulse-compute/pulse/blob/16444cc5e116498e1fdf5f1e4815b4b8c3c74349/wasm/test/kv/K4.md) for the evidence and release boundary.

## 1.0.0-beta.1 — Beta (2026-08-01)

The first public Beta establishes a native-first Pulse application contract
and completes the synchronized release candidate:

- promotes `@pulse-compute/pulse` into the synchronized public package set and
  removes its duplicate Fastly-conditioned bootstrap so provider-specific
  startup remains owned by `@pulse-compute/provider-fastly`.
- adds `--experimental-native-size` to provider-neutral compile and Native
  provider builds. The Native compiler owns the experimental size profile and
  the default remains unchanged.
- moves the fixed provider composition behind a neutral CLI facade. Concrete
  host operations and target policy are now composed from provider-owned
  modules, while Node remains the reference/smoke substrate.
- adds synchronous string logging through `ctx.log.error`, `warn`, `info`, and
  `debug`, including profile thresholds, Native pruning, a compact host ABI,
  provider-owned output, redaction, and four-mode conformance.
- completes direct Fastly JavaScript execution, provider capabilities, package
  effects, local tooling, deterministic source/deployment packaging, and
  downstream runtime compilation.
- seals full-target-support availability for Node and Fastly JavaScript without
  automatic fallback.
- adds revision-bound release reports, sixteen-shard evidence aggregation,
  offline Fastly Native/JavaScript candidates, and exact binary-patch replay.
- adds the bounded Crypto, JWT, and Entities packages to the synchronized
  18-package release catalog;
- synchronizes the Apache-2.0 package metadata, Beta documentation,
  exact `v1.0.0-beta.1` routes, and npm `beta` policy without assigning `latest`;
- performs no deployment or publication; those operations remain separately
  authorized release actions.

- `@pulse-compute/runtime` as the canonical application surface;
- static Router authoring with parameters, mounts, terminal middleware, fallthrough, and error lanes;
- whole-project analysis with explicit effects and continuations;
- schema-backed request, fetch, and response handling;
- provider-neutral portable Wasm and direct native Fastly realization;
- Node development, inspection, testing, and provider conformance;
- package-owned GRIP and asset lowering;
- generated, versioned documentation and guarded release candidates;
- explicit runtime-target support gates with no automatic fallback.

The Beta deliberately rejects unsupported Native source instead of
silently changing execution targets.
