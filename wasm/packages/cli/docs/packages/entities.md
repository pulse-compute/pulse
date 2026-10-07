# `@pulse-compute/entities`

`@pulse-compute/entities` provides bounded, statically declared, schema-bound
operations through the first-party JSON-RPC adapter.

```bash
npm install @pulse-compute/entities@1.0.0-beta.7
```

## Declare an entity router

```ts
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true }),
})

rpc.on('customer.lookup', {
  input: 'tools.CustomerLookupInput',
  output: 'tools.CustomerLookupOutput',
  metadata: {
    title: 'Look up customer',
    description: 'Returns one customer from the governed directory backend.',
  },
}, lookupCustomer)

export default function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
```

`input` and `output` are literal schema IDs declared by the selected Pulse
project, or `null`. A `null` input passes `undefined` to the handler; a `null`
output requires `undefined` and becomes JSON `null`. Metadata must be bounded,
static JSON. Handlers must be resolvable named references and may use the same
governed `ctx` effects as ordinary managed handlers.

The compiler recognizes a deliberately narrow static form: one module-level
router, an inline first-party adapter declaration, standalone module-level
registrations, and one terminal request binding. It rejects aliases, dynamic
names, computed schema IDs, conditional registration, chained registration,
and multiple request-body owners.

With an explicit JavaScript target, schema handlers retain ordinary source
helpers and callbacks. The schema codec owns input and output admission;
handlers still obey Pulse effect-await rules and cannot directly call another
declared handler or recurse. Inspection describes recognized effects in the
declared handler, not the internals of ordinary helpers or dependencies.
Native restrictions are recorded separately as handler eligibility blockers;
JavaScript inspection is not an executable Native lowering. Selecting Native
still enforces those restrictions without fallback.

## JSON-RPC behavior

The first adapter accepts JSON-RPC 2.0 request objects and named object params.
It does not accept batches or positional params. It selects an entity before
schema decoding, invokes the handler once, validates output, and emits stable
JSON-RPC failures without application exception details.

| Input | HTTP result | JSON-RPC result |
|---|---:|---|
| Valid request with `id` | `200` | `result` or a stable `error` with the same `id` |
| Notification without `id` | `204` | Empty body after awaited handler and output completion |
| Unknown method | `200` | `-32601` / `Method not found` |
| Invalid params or schema input | `200` | `-32602` / `Invalid params` |
| Handler or output failure | `200` | `-32603` / `Internal error` |
| Malformed JSON | `200` | `-32700` / `Parse error` |

`acceptEmptyObjectForNoInput: true` additionally permits `{}` for an operation
whose input is `null`. `namedParamsOnly` can only be `true` in this contract.

## JavaScript workflow and inspection

The [Entities tools example](../../examples/10-entities-tools/) defaults to the
Node JavaScript profile. From that example directory, use the ordinary lifecycle:

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The two harness cases exercise the no-input operation and a schema-bound lookup
with a plain-text fetch fixture. Harness fixtures apply to `pulse test`; live
lookup requests need a configured development fixture or backend. Stop the dev
server before continuing to the build.

`pulse inspect` reports the entity plan, deterministic catalog, schema linkage,
redacted handler effects, and target evidence. A successful build writes:

- `entities-catalog.json`: protocol-neutral discovery metadata;
- `entities-inspection.json`: declarations, handler identities/effects, and
  eligibility/measured-execution evidence.

The `cli-entities-installed-workflow` acceptance gate packs the current candidate,
installs example 10 outside the checkout, and runs doctor, inspect, test, dev
startup/request/shutdown, build and artifact inspection in all four profiles.
It checks installed package bytes before/after and matches Native test/build
artifact hashes. This is candidate-package evidence; it does not retroactively
change previously published packages. Fastly test/dev evidence uses its local
fixture runtime, separately from external Viceroy and deployed acceptance.

Both artifacts are static and checkout-independent. They intentionally omit
request/runtime values, request IDs, raw payloads, resolved secrets, and
provider objects. Consumers such as a tools facade should project discovery
from the catalog and invoke a governed adapter boundary; they should not gain a
direct handler or runtime-registry API.

## Target status

| Mode | Beta evidence | Important boundary |
|---|---|---|
| Node JavaScript | Ordinary doctor, inspect, test, dev, and build workflow | Package JavaScript runtime |
| Fastly JavaScript | Measured with Viceroy 0.20.1 | Provider JavaScript package/runtime |
| Node Native | Ordinary doctor, inspect, test, dev, and build workflow | Package-owned guest through the canonical Node host; no JavaScript fallback |
| Fastly Native | Ordinary doctor, inspect, test, dev, and build; emitted artifact replayed with Viceroy 0.20.1 | Provider-owned canonical Fastly runtime; no JavaScript fallback |

The source-checkout task `entities-orchestration-demo` separately exercises the
tools facade and package-owned Native artifact. The `entities-node-native-workflow` and
`fastly-entities-native-workflow` gates separately verify that ordinary tests
execute the same guest bytes emitted by build. Fastly builds write
`bin/main.wasm` and `src/main.as.ts`. Select `host: 'fastly'`, `target: 'native'`
and configure the required Fastly backend/store bindings in the profile.

Fastly `pulse test` and `pulse dev` execute the provider artifact against its
fixture ABI; development fetches require fixtures. Set `PULSE_VICEROY_BIN` when
running the Fastly workflow gate to replay the emitted Wasm with the explicit
local engine and local backend/store configuration. Local Viceroy replay is
separate from live Fastly deployment evidence; no deployment is claimed.

Native remains `provider-dependent`, and every target keeps automatic fallback
disabled. The complete matrix is in [Provider and target compatibility](../reference/compatibility-matrix.md).

Native Entities projects support closed typed schemas, including optional fields,
nested objects, arrays and nullable values. Their generated decoder enforces the
profile's `schemas.maxBytes`; the adapter separately bounds the envelope, params
and output. A provider may reject an oversized request before JSON-RPC handling.

Dynamic JSON (`OpenObject`, `JsonObject`, `JsonValue`, `ScalarRecord`) and schemas
with JSON admission options currently require JavaScript for Entities. Native
builds reject reachable schemas they cannot preserve with
`PULSE_ENTITIES_TARGET_INELIGIBLE`. Catalog eligibility and inspection report
this restriction for entity input/output declarations. Unused schema declarations
do not disqualify an entity. Native also checks schemas used by managed fetch
projections when generating the application.

## Diagnostics

These codes are package-owned entries in the synchronized Beta diagnostic
catalog.

| Code or family | Meaning | Remediation |
|---|---|---|
| `PULSE_ENTITIES_ADAPTER_STATIC_REQUIRED` | Router/adapter declaration is not the supported static form. | Construct one module-level `const` router with inline `adapter: jsonRpc(...)`. |
| `PULSE_ENTITIES_ADAPTER_UNSUPPORTED` | The adapter is not the first-party JSON-RPC adapter. | Use `jsonRpc()`; third-party adapter authoring is not open. |
| `PULSE_ENTITIES_ADAPTER_OPTIONS_INVALID` | Adapter options are unknown or dynamic. | Use literal `namedParamsOnly: true` and an optional literal boolean `acceptEmptyObjectForNoInput`. |
| `PULSE_ENTITIES_DISCRIMINATOR_STATIC_REQUIRED`, `..._INVALID`, `..._DUPLICATE` | An operation name is dynamic, malformed, or repeated. | Use one unique bounded string literal per router. |
| `PULSE_ENTITIES_SCHEMA_MISSING`, `..._ID_INVALID` | `input`/`output` is absent or not a declared literal schema ID/`null`. | Declare both fields and synchronize the project schema registry. |
| `PULSE_ENTITIES_HANDLER_UNRESOLVED`, `..._INVALID` | The handler is not a resolvable named function. | Pass a named module-level function reference. |
| `PULSE_ENTITIES_REGISTRATION_UNSUPPORTED` | Registration is conditional, nested, chained, or otherwise dynamic. | Use standalone module-level `rpc.on(...)` statements. |
| `PULSE_ENTITIES_BINDING_UNSUPPORTED` | The request binding is not one terminal `return rpc.handle(ctx)`. | Return the call directly from the request handler. |
| `PULSE_ENTITIES_BODY_CONSUMER_CONFLICT` | Another owner also consumes the request body. | Give the entity adapter exclusive ownership of the request body. |
| `PULSE_ENTITIES_METADATA_INVALID`, `PULSE_ENTITIES_LIMIT_INVALID`, `PULSE_ENTITIES_LIMIT_EXCEEDED` | Static metadata or bounded data exceeds the contract. | Reduce or correct the declaration; limits are package-owned and not app-configurable. |
| `PULSE_ENTITIES_TARGET_INELIGIBLE` | The chosen provider/target cannot realize the declaration. | Select an evidenced mode or supply the separately governed provider integration. Never rely on fallback. |

Malformed envelopes can additionally produce bounded scanner codes such as
`PULSE_ENTITIES_JSON_MALFORMED`, `PULSE_ENTITIES_JSON_TOO_DEEP`,
`PULSE_ENTITIES_ENVELOPE_TOO_LARGE`, and
`PULSE_ENTITIES_PAYLOAD_TOO_LARGE`. Clients receive only the stable JSON-RPC
mapping, while provider observability records a redacted failure category.

## Related material

- [Entity engine, adapters, and facades](../concepts/entities-and-adapters.md)
- [Canonical API](../../API.md#entities-api)
- [Entities lowering maintainer reference](../contributing/entities-lowering.md)
- [Executable Entities tools example](../../examples/10-entities-tools/)
