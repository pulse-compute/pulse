<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-07-16
review-by: 2027-01-16
pulse-doc-meta:end -->

# Entities lowering maintainer reference

`@pulse-compute/entities` uses a synchronized, trusted first-party package
lowerer. This page records the package-specific boundary; the general protocol
remains authoritative in [Package lowerer contract](./package-lowerer-contract.md).

The package is part of the synchronized Beta release. Changes here do not alter
release membership, publish it, or make its internal toolchain subpaths a
public extension API.

## Synchronized surfaces

| Surface | Authority |
|---|---|
| `packages/entities/pulse.package.json` | Product status, root symbols, target policy, provider requirements |
| `packages/entities/pulsewasm.manifest.cjs` | Trusted first-party manifest and compiler entry |
| `packages/entities/pulsewasm.compiler.cjs` | Static extraction, plan/catalog/inspection, managed-handler descriptors |
| `packages/entities/pulsewasm.native.cjs` | Package-owned bounded Native dispatcher source |
| `packages/entities/as/index.as.ts` | Native source template/contract input |
| `wasm/packages/contracts/src/entities/` | Versioned shared normalization, limits, JSON-RPC, catalog, and plan contracts |
| `packages/entities/conformance/i9.json` | Shared four-mode corpus/evidence declaration |

Keep product metadata, manifest exports, compiler output versions, Native
source expectations, and conformance evidence synchronized. The manifest and
compiler subpaths under the package's `pulsewasm` namespace, plus the
`./pulsewasm-native` export, are for the trusted toolchain only.

## Static extraction contract

The lowerer may inspect source and declared schema metadata; it must not execute
application code. It accepts one module-level `const` `EntityRouter`, an inline
`jsonRpc` adapter, standalone module-level registrations, literal
discriminators, literal schema IDs or `null`, bounded static metadata,
resolvable named handlers, and one terminal request binding.

Every rejected form needs a deterministic `PULSE_ENTITIES_*` diagnostic with a
specific remediation. Never recover by evaluating dynamic source, discovering
dependencies at runtime, scanning arbitrary installed packages, or changing
the selected target.

## Managed handlers and schemas

Each registration becomes one managed-handler descriptor. The descriptor owns
the declared input/result shape and points to one reachable named handler. The
normal reachable-graph compiler owns effects and continuations. The package
lowerer must report redacted summaries and provider requirements without
copying runtime values, raw payloads, request IDs, resolved secrets, or provider
objects into plans or inspection.

Schema codecs remain private request-bound capabilities. The adapter can decode
only the selected registration's input schema and encode only its output schema.
Do not expose codec objects, registry enumeration, raw body access, or a second
body consumer to package code.

## Native realization

The package-owned Native source must preserve the JavaScript runtime semantics:
one bounded envelope scan, selection before schema decoding, one handler
invocation, stable failure categories, output validation, JSON-RPC framing, and
synchronous `204` notification acknowledgement. It may use only the provider
requirements declared by the package contract.

Native status remains `provider-dependent`. Node Native uses the canonical
package source. Fastly Native evidence uses an explicit provider-owned adapter
over the exact package source. Do not wire that adapter into the ordinary
Fastly project build or change the product status as part of a documentation or
candidate-seal change. Any such integration is a separately classified product
unit with provider ownership and focused tests.

## Catalog and evidence invariants

- Catalog ordering and hashes are checkout-independent and deterministic.
- Declaration, eligibility, measured execution, and release assignment are
  separate claims.
- Fastly execution evidence must name the external engine and run the generated
  artifacts; compile-only evidence is insufficient.
- Every target keeps `automaticFallback: false`.
- A tools/MCP facade may consume the static catalog but does not add protocol
  lifecycle state or direct handler access to Pulse runtime core.

Run the focused Entities tasks, the package/tarball clean-consumer candidate
seal, affected H5 authority gate, executable docs, aggregate profiles, and
external Viceroy evidence before recording a candidate decision. A seal may
record a blocker; it must not fix an unrelated product problem in place.
