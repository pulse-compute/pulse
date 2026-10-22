# Native build optimization

Ordinary Native compilation uses **O3, shrink level 2, without convergence**.
Its recorded recipe is `native-bounded-size`. No optimization flag is needed:

```bash
pulse build
pulse compile
```

`pulse build` produces the selected provider's deployment output. `pulse compile`
produces provider-neutral Native Wasm. These settings apply to portable
compilation, Node Native and Fastly Native builds. They do not change source
eligibility, provider selection or the application's supported behavior.

## Choose a recipe

| Selection | Recorded recipe | AssemblyScript settings | When to use it |
|---|---|---|---|
| No override | `native-bounded-size` | O3 / shrink2 / no convergence | The ordinary default, unless the selected Native profile configures another recipe. |
| `--native-shrink0` | `native-shrink0` | O3 / shrink0 / no convergence | Restore the previous recipe when investigating an optimization regression or comparing a workload. |
| `--experimental-native-size` | `experimental-native-size` | O3 / shrink2 / convergence | Try additional optimizer convergence and measure the resulting artifact and compilation cost. |
| `--experimental-native-bounded-size` | `experimental-native-bounded-size` | O3 / shrink2 / no convergence | Keep existing explicit selections and their historical identity; its settings match the ordinary default. |

For a one-command override:

```bash
pulse build --native-shrink0
pulse compile --native-shrink0
pulse build --experimental-native-size
```

The three recipe flags are **mutually exclusive**. An explicit flag overrides
`nativeOptimization` in the selected profile. Without a flag, that profile's
setting wins; without either, Pulse uses `native-bounded-size`.

To keep a selection in `.pulse/config.ts`, set it on a Native profile:

```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig(() => ({
  pulse: { entry: 'src/index.ts', defaultProfile: 'local' },
  local: {
    host: 'node',
    target: 'native',
    nativeOptimization: 'native-shrink0',
  },
}))
```

Set `nativeOptimization` to `native-bounded-size`, or remove it, to return that
profile to the ordinary default. The field accepts all four recipe identities
in the table. See [project configuration](./project-config.md#nativeoptimization).

JavaScript profiles reject `nativeOptimization`, and JavaScript `pulse build`
rejects these flags. `pulse compile` always requests Native compilation, even
when the selected profile otherwise targets JavaScript, and still requires
Native-compatible source.

Convergence asks the optimizer to continue seeking a stable result; it can add
compilation work without reducing the final artifact. Smaller Wasm does not by
itself prove lower request latency or memory use. Compare completed builds and
representative workloads before adopting an override. Guest-linked builds also
have their own prebuilt inputs and final-link optimization; a primary compiler
recipe does not replace those steps.

## Optional json-as cache arena setting

`--elide-json-cache-arena` is an independent Native option. It omits json-as's
1 MiB string-cache arena **only when string caching is disabled**. The default
keeps that allocation. Enabled caches retain their arena, and schema-free
artifacts are unchanged. It can be combined with one recipe flag:

```bash
pulse build --elide-json-cache-arena
pulse compile --native-shrink0 --elide-json-cache-arena
```

The option reaches portable, Node Native and Fastly Native compilation.
JavaScript builds reject it. This is a targeted json-as allocation setting,
not a general AssemblyScript optimizer or garbage-collection switch. It does
not change schema semantics or reclaim retained values.

**Peak memory can increase for allocation-heavy workloads**, even though the
eager arena allocation is removed. A retained escaped-string stress observation
increased linear-memory capacity from 110 MiB to 148 MiB with this option;
that observation is not a prediction for another application. Measure startup
and peak memory for the workload you intend to run. The adapter is pinned to
json-as 1.5.0 and fails if the expected dependency source changes.

## Inspect the result

Build manifests and retained reports record the selected recipe. Use a completed
build's `pulse report` or `pulse report --html` to inspect the actual artifacts;
keep the source, target, toolchain and recipe identified when comparing results.
Historical absent recipe metadata and `default` report identities keep their
original meaning; they are not reinterpreted as today's bounded default.

The arena selection is recorded as `elideJsonCacheArena` in the report recipe and
`jsonAs.elideDisabledCacheArena` in schema-active Native manifests. Applied build
observations identify `schema-cache-arena-transform.cjs`. Historical reports
without the field did not record the setting.

See the generated [CLI reference](./cli.md) for exact command syntax and the
[JSON schema guide](../guides/json-schemas.md) for schema admission and limits.
