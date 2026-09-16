# Provider and target compatibility

This page is the single compatibility matrix for the Pulse Beta.
It records the tested source forms, provider bindings, target realizations, and
deployment boundary for the four explicit execution modes. The same managed
handler and Router contract applies in every column; target selection changes
the realization, not the application model.

For the exact TypeScript and JavaScript source subset behind these rows, see
[Managed handler TypeScript and JavaScript](./handler-authoring.md).

## Reading the matrix

- `Yes` means the form is part of the current contract and has focused
  cross-target evidence.
- `JS only` means the form may remain in an explicitly selected JavaScript
  application but makes Native lowering ineligible.
- `No` means the form is outside the managed Pulse contract even when the
  underlying JavaScript engine or provider offers it.
- A provider resource name, such as `Config Store`, names the realization
  selected by that provider/target cell. It does not expose the provider SDK to
  application code.

Pulse never changes columns automatically. A Native eligibility failure stops
the Native build; it does not authorize automatic JavaScript fallback.

## Source-form compatibility

| Source form | Node JS | Fastly JS | Node Native | Fastly Native | Notes |
|---|---:|---:|---:|---:|---|
| Async-shaped managed handler | Yes | Yes | Yes | Yes | Native erases the authoring wrapper; it does not link Promise, JSPI, or Asyncify semantics. |
| Static `Router` topology and terminal `next()` | Yes | Yes | Yes | Yes | Covers static `get`, `head`, `post`, `put`, `patch`, `delete`, middleware, mounts, parameters, trailing wildcard, fallthrough, and the error lane. |
| Root-only `Pulse.on` and non-HTTP event context | Yes | No | Yes | No | Node owns the bounded reference ingress. Fastly source remains inspectable but execution/build eligibility fails closed. |
| Awaited one-way `ctx.emit` acceptance | Yes | No | Yes | No | Static schema-bound frames only; no delivery, loopback, public bus, call surface, or target fallback. |
| Sequential awaits of trusted Pulse effects | Yes | Yes | Yes | Yes | JavaScript preserves source order. Native lowers effects and continuations and may group adjacent independent effects without changing results. |
| `await ctx.parallel({ fixed: effect })` | Yes | Yes | Yes | Yes | Requires a nonempty inline object with fixed non-index keys and fresh request-owned Pulse effects. |
| Request metadata, route parameters, request state, logging, and response construction | Yes | Yes | Yes | Yes | These are synchronous managed surfaces; awaiting a proven synchronous value is redundant and may warn. |
| Schema-bound request, fetch, and response JSON | Yes | Yes | Yes | Yes | Schema and response-case IDs are literal project declarations. |
| Generic bounded JSON with `pulse.strict: false` | Yes | Yes | Yes | Yes | The plan records the generic host parser. Strict mode requires a declared schema. |
| Direct opaque response pass-through | Yes | Yes | Yes | Yes | Returnable, but not inspectable, iterable, buffered, transformed, or retained in userland. |
| Supported package-root Assets and GRIP calls | Yes | Yes | Yes | Yes | JavaScript runs the package implementation. Native accepts the package's synchronized, bounded lowerable subset. |
| Ordinary target-compatible JavaScript package API | Yes | Yes | No | No | JavaScript packaging must include a provider-compatible dependency. Native requires a trusted package-owned lowerer. |
| Arbitrary Promise construction or library await | JS only | JS only | No | No | Never valid inside `ctx.parallel`; Native reports the first eligibility boundary and never falls back. |
| Ambient `fetch`, timers, environment/process access, filesystem, sockets, or provider SDK | No | No | No | No | Use `ctx` effects and configured provider bindings. |
| Userland body streams, chunk transforms, or background work | No | No | No | No | Structured reads are bounded, opaque bodies stay host-owned, and work ends with the request. |

## Provider and target realization

The application-facing source form stays the same across these cells. Text in a
cell names the provider-owned binding or artifact that realizes it.

| Capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |
|---|---:|---:|---:|---:|---|
| Canonical handler and Router execution | Yes | Yes | Yes | Yes | Shared handler, Router, context, effect, and result contracts. |
| Request and structured responses | Yes | Yes | Yes | Yes | Provider adapters preserve the canonical request/response model. |
| Single, sequential, and keyed-parallel fetch | Yes | Yes | Yes | Yes | Fetch is a `ctx` effect; no ambient fetch authority is implied. |
| Explicit JSON schemas and bounded generic JSON | Yes | Yes | Yes | Yes | Schema policy is project-owned and target-neutral. |
| Config reads | Test/dev binding | Config Store | Test/dev binding | Config Store | Exact names are resolved from the selected profile; no ambient fallback. |
| Secret reads | Test/dev binding | Secret Store | Test/dev binding | Secret Store | Secret values remain provider-owned and are redacted from diagnostics and logs. |
| KV `get` and `put` | In-memory binding | KV Store | In-memory binding | KV Store | Namespaces are explicit profile bindings. |
| Opaque pass-through | Yes | Yes | Yes | Yes | Bodies remain host-owned in all four modes. |
| GRIP framing and configured broadcast | Yes | Yes | Yes | Yes | The package-root contract owns the portable operation shape. |
| `ctx.log` and redaction | Yes | Yes | Yes | Yes | Provider output format may differ; the level and redaction contract does not. |
| Reference event ingress and `ctx.emit` acceptance | Bounded Node adapter | No | Bounded Node adapter | No | Direct parity evidence only: FIFO ingress, exact-frame acceptance, no loopback, delivery promise, public bus, call surface, or automatic fallback. |
| Local execution evidence | Node lifecycle | Provider emulation | Canonical host | Controlled ABI host | Local proof is not production provider activation. |
| Deployment candidate | Source package | Source package plus downstream runtime Wasm | Node build | `bin/main.wasm` | A candidate records the selected target and does not contain an automatic fallback artifact. |
| Production deployment and activation | Not applicable | Human-operated | Not applicable | Human-operated | Fastly reality, deployment, and activation remain explicit external gates. |

## Entities Beta package

This table records measured behavior for the implemented
`@pulse-compute/entities` package. Release membership does not erase the
separate ordinary-lifecycle and Fastly Native integration boundaries.

| Entities capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |
|---|---:|---:|---:|---:|---|
| Static `EntityRouter` declarations | Yes | Yes | Yes | Yes | One literal router, first-party adapter, static registrations, named handlers, and one terminal binding. |
| Bounded JSON-RPC request execution | Measured | Measured | Measured | Measured | Fastly cells execute generated artifacts with Viceroy 0.20.1. |
| Declared input/output schema codecs | Measured | Measured | Measured | Measured | Selection precedes decode; only the selected schemas are available. |
| Managed handler effects | Measured | Measured | Measured | Measured | The shared corpus includes schema work, fetch, and stable negative cases. |
| Deterministic catalog and inspection | Yes | Yes | Yes | Yes | Catalog and redacted inspection are package-owned build artifacts. |
| Ordinary project build integration | Yes | Yes | No | No | JavaScript source packaging emits the catalog; Native evidence uses package source outside the ordinary build adoption path. |
| Ordinary project `test`/`dev` loading | Blocked | Blocked | Not applicable | Not applicable | The shared JavaScript loader requests an unexported physical entry instead of the public package root. |
| Automatic target fallback | No | No | No | No | Eligibility, measured execution, and release assignment remain separate claims. |

## JWT and crypto Beta packages

This table records the sealed Phase D and E behavior of the synchronized
`1.0.0-beta.5` JWT/crypto packages. Validation does not itself authorize npm
publication.

| Candidate capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |
|---|---:|---:|---:|---:|---|
| HS256 MAC verification | `runtime-builtin` | `runtime-builtin` | `guest-source:pulse-hmac-as` | `guest-source:pulse-hmac-as` | All cells consume one bounded corpus and return the same closed result categories. |
| ES256 signature verification | `runtime-builtin` | `runtime-builtin` | `guest-linked:pulse-es256-rustcrypto-p256` | `guest-linked:pulse-es256-rustcrypto-p256` | The 38-case matrix runs both JavaScript cells and both Native optimization artifacts per provider with exact failure parity. |
| Exact realization selection | Yes | Yes | Yes | Yes | Profile replacement is whole-value replacement; there is no array or object merging. |
| Disabled fallback | Yes | Yes | Yes | Yes | Missing capability, unavailable pins, and realization failures stop without choosing another backend or target. |
| Secret-safe realization reporting | Yes | Yes | Yes | Yes | Reports identify algorithms and realizations but never key, message, or authenticator bytes. |
| Prebuilt `guest-linked` unit required | No | No | ES256 only | ES256 only | Native HS256 remains first-party AssemblyScript in the primary module; Native ES256 uses the exact audited RustCrypto guest. |
| JWT verification | HS256, ES256 | HS256, ES256 | HS256, ES256 | HS256, ES256 | RS256 and EdDSA remain unavailable; no failure changes algorithms, realizations, targets, or providers. |
| JWT authenticity before claims | Yes | Yes | Yes | Yes | Invalid authenticity exposes no claims and stops before clock, registered-claim, or schema authority. |
| Exact final-artifact execution | Package runtime | Compute artifact | Primary Native module | `bin/main.wasm` | Native cells execute the package-owned guest sources; JavaScript cells execute the exact selected runtime builtin. |

## Evidence and authority

Each row above is grounded in one or more of these current contracts or focused
proofs:

- **Managed surface and target support:** `HANDLER_SURFACE_DEFINITIONS`,
  `HANDLER_AUTHORING_MODES`, and `HANDLER_AUTHORING_POLICY_VERSION` in
  `wasm/packages/contracts/src/handler/surface-contract.js`.
- **Public TypeScript shape:** `packages/runtime/src/index.d.ts` owns the
  Promise-shaped handler, terminal `RouterNext`, context, effect, body, and
  result types.
- **Async, trusted await, ambient authority, and `ctx.parallel` boundaries:**
  `wasm/test/lowering/assert-canonical-api-lowering.cjs`.
- **Native source realization without Promise or Asyncify:**
  `wasm/test/compiled/assert-canonical-native-wasm.cjs`.
- **Four-mode behavior and target integrity:**
  `wasm/test/contracts/assert-four-mode-conformance.cjs` and
  `wasm/test/support/four-mode-conformance.cjs`.
- **JavaScript effect order and explicit parallel behavior:**
  `wasm/test/contracts/assert-javascript-effect-adapter.cjs`.
- **Router and context parity:**
  `wasm/test/contracts/assert-node-router-context-parity.cjs`.
- **Schemas, generic JSON, and body ownership:**
  `wasm/test/contracts/assert-schema-codecs.cjs`,
  `wasm/test/contracts/assert-fetch-projections-request-bodies.cjs`, and
  `wasm/test/runtime/assert-canonical-opaque-passthrough.cjs`.
- **Config, secrets, KV, exact bindings, and redaction:**
  `wasm/test/contracts/assert-config-secrets-kv-redaction.cjs`.
- **Assets and GRIP package-root support:**
  `wasm/test/compiled/assert-package-root-native.cjs`,
  `wasm/test/contracts/assert-grip-cross-target-conformance.cjs`, and the
  package runtime tasks registered in `wasm/test/suite/registry.cjs`.
- **Provider candidates and external reality boundary:** the Node/Fastly
  provider tasks in `wasm/test/suite/registry.cjs` and the mandatory Fastly
  reality gate declared by `release/pulse-release-manifest.json`.
- **Entities package:** static catalog and inspection proofs in
  `wasm/test/entities/assert-entities-catalog.cjs` and
  `wasm/test/entities/assert-entities-inspection.cjs`; orchestration boundaries
  in `wasm/test/entities/assert-entities-orchestration-demo.cjs`; and the shared
  four-mode Viceroy corpus in
  `wasm/test/entities/assert-entities-cross-target.cjs`.
- **JWT/crypto packages:** the crypto corpus in
  `packages/crypto/conformance/hs256.json`,
  `wasm/test/crypto/assert-crypto-cross-target-conformance.cjs`, and
  `wasm/.test-results/crypto-c4/phase-c-seal.json`; the JWT composition seal in
  `wasm/.test-results/jwt-d4/jwt-phase-d-seal.json`; and the four-cell,
  210-execution cross-target seal in
  `wasm/.test-results/jwt-e4/jwt-phase-e-seal.json`. The Fastly reality tasks
  execute generated JavaScript and Native provider artifacts locally through
  `fastly compute serve`; they do not deploy or activate a service.
  ES256 target alignment is recorded by the six-cell, 228-evaluation matrix in
  `wasm/.test-results/boundary-h4/es256-six-cell-matrix.json`, including the
  Fastly JavaScript runtime Wasm under Viceroy.

The focused documentation assertion
`wasm/test/docs/assert-compatibility-matrix.cjs` keeps the matrix header unique,
checks the public target order, verifies its evidence paths, and compares the
documented managed-surface rule with the canonical handler-surface registry.

## Related reference

- [Managed handler TypeScript and JavaScript](./handler-authoring.md)
- [Beta scope](../preview-scope.md)
- [Node build and execution](../guides/deploying-node.md)
- [Fastly deployment candidates](../guides/deploying-fastly.md)
- [Diagnostics and remediation](./diagnostics.md)
