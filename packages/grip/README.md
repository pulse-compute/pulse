# @pulse-compute/grip

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications using stateless GRIP/Fanout HTTP framing and request-bound broadcast behavior.<br>
> **Install directly:** Yes, only when the application uses GRIP/Fanout behavior.<br>
> **Supported entry points:** `@pulse-compute/grip`<br>
> **Stability:** The package root has bounded JavaScript and Native HTTP-framing realization plus configured Node/Fastly broadcast; /pulsewasm remains compatibility-only.<br>
> **npm:** [`@pulse-compute/grip`](https://www.npmjs.com/package/@pulse-compute/grip)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/grip/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.4` package policy.
<!-- pulse-package-status:end -->

The normal package root provides stateless GRIP/Fanout HTTP framing:

```ts
import { grip } from '@pulse-compute/grip'

if (grip.isWebSocket(ctx.req)) {
  return grip.handoff({ channel: 'events:demo' })
}

return grip.subscribe(new Response(null), {
  channel: 'events:demo',
  mode: 'stream',
})
```

Outbound publication is the package's request-bound broadcast API and effect:

```ts
await grip.broadcast(ctx, {
  channel: 'events:demo',
  data: { type: 'message', value: 'hello' },
})
```

Pulse owns no WebSocket object or connection lifecycle. An external gateway owns connections, fan-out, backpressure, and reconnection. Cross-target conformance covers the bounded JavaScript/Native framing surface and configured Node/Fastly broadcast providers. Native lowering requires supported static options and messages; unsupported expressions fail without target fallback.

`@pulse-compute/grip/pulsewasm` remains a compatibility Native facade for
existing fixtures and is not recommended for new applications. Migration
guidance is published at
<https://pulsecompute.io/v1.0.0-beta.4/guides/compatibility-imports/>.

Broadcast configuration is provider-owned. It requires an explicit publish/control endpoint and may name a bearer-token secret reference; it never discovers an ambient endpoint or credential. Public gateway URLs and ingress routes are separate concerns. This bounded realization is included in both generally available JavaScript targets.
