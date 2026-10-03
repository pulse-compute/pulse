# MW-01: effectful middleware sharing

Focused proof on 3 October 2026, against Pulse `latest` base
`e9bf187d0de0ccc54248a29bca24937d6bed79a9` plus this patch.
Exact implementation and fixture hashes are in `mw01-evidence.json`.

Run from the repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs --task middleware-sharing-mw01
```

The opt-in task passed in 24.77 seconds. This is total proof time, including
compilation, inspection and execution, not a compiler benchmark.

| Registrations | Optimization | Wasm bytes | Retained body partitions | Retained body bytes |
|---:|---|---:|---:|---:|
| 1 | Normal | 43,414 | 2 | 2,716 |
| 2 | Normal | 44,861 | 2 | 2,747 |
| 1 | Experimental bounded size | 37,048 | 2 | 1,997 |
| 2 | Experimental bounded size | 38,283 | 2 | 1,997 |

One imported, effectful middleware handler is registered on scoped child routers.
Both registrations call the same two retained body partitions around a text-fetch
suspension. The named inspection companion has byte-identical noncustom sections
to the production build. Each retained partition is reachable from an actual
export and called by the dispatcher; indirect calls are absent.

The proof executes 18 requests across the four cells, covering normal execution,
early response, response after suspension, error transfer, fresh requests and
mount/scope misses. One further request executes two middleware registrations in
sequence and observes both state updates and effects. It also rejects crossed
continuation ownership, verifies deterministic plans and serialized validation,
checks pure/effectful helper fallback, and exercises 6 positive and 11 negative
retention-selection controls.

This establishes retained middleware bodies in a tiny Fastly ABI fixture. It does
not establish an application-size saving or compare against unshared output.
The second registration still adds dispatch, binding and terminal-route code:
1,235 bytes in bounded-size mode. Normal-mode body encoding also changes slightly
between builds; body partition count stays fixed. Node, deployment, full suites
and release gates were not run. Terminal `next` behavior and host ABI are unchanged.

Helpers, loops, groups and non-text-fetch effects retain ordinary Native lowering.
The exclusion callback is internal inspection, with no new public flag or API.
