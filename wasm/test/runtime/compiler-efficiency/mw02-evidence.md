# MW-02: shared time/digest stages with bounded pure loops

Focused proof on 3 October 2026, against Pulse `latest` base
`9576fe919ecf4a62b425f213e86e822e0d98c6cf` plus this patch.
Exact tested source and fixture hashes are in `mw02-evidence.json`.

Reproduce from the repository root with the opt-in task:

```sh
node wasm/scripts/run-wasm-tests.cjs --task middleware-sharing-mw02
```

The completed run invoked the same task file directly:

```sh
node --liftoff-only wasm/test/runtime/compiler-efficiency/mw02-middleware.cjs mw02-public-proof.json
```

| Registrations | Optimization | Wasm bytes | Retained stage partitions | Retained stage body bytes |
|---:|---|---:|---:|---:|
| 1 | Experimental bounded size | 96,317 | 1 | 981 |
| 3 | Experimental bounded size | 97,380 | 1 | 981 |

The generic owner decodes a schema-bound record, updates optional fields, scans
an array with a literal-capped pure loop, encodes the result, samples time, and
digests the encoded value plus that sample. It then writes request state and
terminates or transfers through `next()`. Two registrations execute sequentially
on one path; the third has a separate scope and terminal route.

All 11 requests passed: repeated same-request visits, present/absent/empty optional
fields, break/continue and capped scanning, early and post-effect responses,
unavailable clock, scope misses, and a fresh request after failures. Exact output
and digest assertions connect value work, effect ordering and the selected
terminal continuation. Each registration retains its own two effect and
continuation IDs.

Six independently rehashed invalid plans were rejected: foreign loop counter,
invalid cap, an effect inside the pure loop, crossed effect binding, crossed
continuation binding, and a mismatched digest contract descriptor. Serialized
validation and deterministic plan hashes also passed.

Production Wasm and its named companion have identical noncustom sections. The
same substantial stage body survives once and is called directly from the
dispatcher. Schema serialization retains its existing JSON-AS indirect callback;
the proof allows only that exact function under an explicit schema-only option.
The default O18/O19 inspection rule remains strict.

These measurements establish sharing, not an application-size saving. Additional
registration/route wiring still adds 1,063 bytes. Recorded cell time includes
compilation, companion inspection and execution and is not a compiler benchmark.
No full application, Node provider, deployment, release gate or full suite ran.

The attempt history is retained in the JSON evidence. Initial synthetic fixture
forms exposed two existing Fastly gaps: the schema/error-wrapper call signature
and `typeof` unary execution. The final fixture uses an ordinary early response
and a schema-proven `note !== undefined` guard. Neither provider gap is changed
by MW-02. The inspection helper was also extended to mirror schema compilation
settings; byte equality remains required.

Helper calls, read/effect loops, groups, borrowed effect results and all other
effect kinds keep ordinary Native lowering. Existing loop caps, provider
realization, terminal `next()` semantics and the host ABI remain unchanged.
