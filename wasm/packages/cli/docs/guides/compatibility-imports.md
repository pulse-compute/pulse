# Compatibility imports and migration

Current application code imports Assets and GRIP from their package roots:

```ts
import { assets } from '@pulse-compute/assets'
import { grip } from '@pulse-compute/grip'
```

Older fixtures may import `@pulse-compute/assets/pulsewasm` or
`@pulse-compute/grip/pulsewasm`. Those subpaths remain bounded compatibility
surfaces; they are not the recommended starting point for a new application and
do not define a general package-extension convention.

## Assets

Replace the compatibility import with the package root:

```diff
- import { assets } from '@pulse-compute/assets/pulsewasm'
+ import { assets } from '@pulse-compute/assets'
```

The supported package-root surface uses `assets.lookup(ctx, ...)` for the
request-bound effect and `assets.respond(...)` for response adoption. Check
argument eligibility when the selected target is Native; JavaScript execution
does not widen the Native lowering contract.

See the [Assets package guide](../packages/assets.md).

## GRIP

GRIP migration is an API migration, not only an import rewrite. The compatibility
facade exposes the older `channel`, `hold`, and `publish` shape. The package root
separates pure HTTP framing from the request-bound broadcast effect:

- `grip.isWebSocket(request)` classifies a request;
- `grip.subscribe(response, options)` decorates a response;
- `grip.handoff(options)` constructs a gateway handoff response;
- `await grip.broadcast(ctx, message)` emits configured outbound work.

Move new route code to that package-root model and keep gateway connection
ownership outside Pulse. The canonical Fastly example now uses the package-root
`grip.broadcast` contract; the older compatibility fixture is no longer part of
the public examples set.

See the [GRIP package guide](../packages/grip.md) and
[GRIP/Fanout guide](./grip.md).

## Internal filenames are not authoring paths

First-party packages still contain names such as `pulsewasm.manifest.cjs`,
`pulsewasm.compiler.cjs`, and `pulsewasm.lowerable-library-manifest.v2`. Those
are repository and toolchain protocol names. They do not imply that an
application should import a `/pulsewasm` subpath or that third-party compiler
builders can self-register.

The current trust boundary is documented in
[Package-owned lowering](../concepts/package-owned-lowering.md). Contributor
protocol details remain internal to the synchronized release set.
