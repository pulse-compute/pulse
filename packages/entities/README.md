# `@pulse-compute/entities`

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications declaring bounded schema-backed entity operations through the first-party JSON-RPC adapter.<br>
> **Install directly:** Yes, when an application declares entity operations.<br>
> **Supported entry points:** `@pulse-compute/entities`<br>
> **Stability:** The package root and first-party JSON-RPC adapter are supported Beta contracts; compiler integration subpaths remain toolchain-only.<br>
> **npm:** [`@pulse-compute/entities`](https://www.npmjs.com/package/@pulse-compute/entities)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/entities/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.4` package policy.
<!-- pulse-package-status:end -->

Bounded, statically declared operations for Pulse applications.

```ts
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'

const rpc = new EntityRouter({
  adapter: jsonRpc({
    namedParamsOnly: true,
    acceptEmptyObjectForNoInput: true,
  }),
})

rpc.on('customer.lookup', {
  input: 'tools.CustomerLookupInput',
  output: 'tools.CustomerLookupOutput',
  metadata: { title: 'Look up customer' },
}, lookupCustomer)

export default function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
```

The application must declare one module-level router, literal first-party
adapter options, module-level `rpc.on(...)` registrations, literal schema IDs
or `null`, resolvable named handler references, and one terminal
`return rpc.handle(ctx)` request binding. These constraints let the trusted
first-party compiler extract declarations without executing application code.

## Public package API

- `new EntityRouter({ adapter })` creates one statically inspectable registry.
- `router.on(discriminator, declaration, handler)` registers a unique bounded
  discriminator and returns the router.
- `router.handle(ctx)` consumes the request boundary and returns a JSON-RPC
  `Response`.
- `jsonRpc(options?)` creates the only supported adapter. Named object params
  are mandatory. `acceptEmptyObjectForNoInput` defaults to `false`.
- `EntityDeclaration`, `EntityHandler`, `EntityRouterOptions`, `JsonRpcOptions`,
  and the exported static JSON/deep-readonly types describe that surface.

The `./pulsewasm/manifest`, `./pulsewasm/compiler`, and `./pulsewasm-native`
exports are synchronized trusted toolchain entries, not application APIs or a
third-party plugin protocol.

## Request and handler semantics

The first-party adapter accepts one bounded JSON-RPC 2.0 object. It selects the
operation before schema decoding, accepts only named params, invokes the
selected handler once, validates the declared output, and emits a bounded
response. Requests and protocol failures use HTTP `200` with JSON-RPC bodies.
Notifications execute synchronously and return an empty HTTP `204` response.
Application exceptions and values are never copied into client-visible error
messages.

An input schema ID decodes only the selected `params` value. An output schema
ID validates and encodes only the selected handler result. `null` input means
the handler receives `undefined`; `null` output requires `undefined` and is
encoded as JSON `null`. Handlers receive the normal governed `PulseContext`, so
effects such as `ctx.fetch` retain their existing provider authority and
redaction rules.

## Inspection and target evidence

`pulse inspect` exposes static declarations, schemas, handler identities,
redacted handler effects, target reasons, and deterministic catalog identity.
Builds emit `entities-catalog.json` and `entities-inspection.json`. These files
exclude runtime payloads, request IDs, resolved secrets, provider objects, and
application values.

The JavaScript package target is `supported`; Native is
`provider-dependent`. One shared corpus has measured Node JavaScript, Node
Native, Fastly JavaScript, and Fastly Native execution. Fastly evidence uses
Viceroy 0.20.1. Fastly Native uses an explicit provider-owned adapter over the
exact package-owned Native source; that adapter is not wired into the ordinary
Fastly Native project build. No target has automatic JavaScript fallback.

## Diagnostics

Declaration/lowering failures use `PULSE_ENTITIES_*` codes. The most common
groups are:

- adapter: `PULSE_ENTITIES_ADAPTER_STATIC_REQUIRED`,
  `PULSE_ENTITIES_ADAPTER_UNSUPPORTED`, and
  `PULSE_ENTITIES_ADAPTER_OPTIONS_INVALID`;
- registration: `PULSE_ENTITIES_DISCRIMINATOR_*`,
  `PULSE_ENTITIES_REGISTRATION_UNSUPPORTED`, and
  `PULSE_ENTITIES_BINDING_UNSUPPORTED`;
- schemas/handlers: `PULSE_ENTITIES_SCHEMA_*`,
  `PULSE_ENTITIES_HANDLER_*`, and `PULSE_ENTITIES_DECLARATION_INVALID`;
- boundedness: `PULSE_ENTITIES_METADATA_INVALID`,
  `PULSE_ENTITIES_LIMIT_*`, and `PULSE_ENTITIES_BODY_CONSUMER_CONFLICT`;
- eligibility: `PULSE_ENTITIES_TARGET_INELIGIBLE`.

The package diagnostics are part of the synchronized Beta diagnostic catalog.
See the [Entities package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/entities/)
for remediation and the [entity/adapter model](https://pulsecompute.io/v1.0.0-beta.4/concepts/entities-and-adapters/)
for the authority boundary.

## Deliberate exclusions

Raw JSON access, schema codec objects, provider runtime objects, dynamic
registration, third-party adapters, and public runtime catalog enumeration are
not part of the API. The package is an entity engine plus one JSON-RPC adapter;
it is not an MCP server. Tools/MCP facades and future Worker/event adapters
belong outside the engine and must invoke a governed request/event boundary.
