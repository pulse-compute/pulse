# MEM09 — reuse managed Node conditional-KV normalization

Entry point: `runtime-effects`. Class: hardening. Base: merged MEM08,
`fa50363` on `latest`. The effect-capability and continuation-runtime owners are
involved; their semantics and public contracts are unchanged.

## Implementation

The managed Node Native driver previously normalized a conditional-KV result in
`executeConditionalKv` and again in `controller.prepareEffectResult`. The first
normalization detaches and freezes the provider result and registers its text
leaves for redaction. The second parse creates another physical copy of large
strings, while the redaction set retains the first copy.

The managed driver now directly uses the result returned by
`executeConditionalKv`. This is a local branch after that call, not an option,
provider-supplied marker, new controller method or public bypass. The shared KV
boundary uses the same execution limits and also owns admission-failure,
timeout, transport-failure and write-outcome values. Non-conditional effects
still go through `prepareEffectResult`.

The public raw-controller `prepareEffectResult` remains unchanged. Budget and
pending-ticket checks still run after the asynchronous operation; result
settlement, resume, trace production, disposal and cancellation are unchanged.
No handles or redaction roots are released, and PS3 accounting is not refunded.

## Regression coverage

`wasm/test/runtime/conditional-kv-normalization.cjs` runs inside the existing
`canonical-native-wasm` task. It exercises:

- Provider mutation after normalization, with the original generation and nested
  payload still visible to the guest.
- Payload/key/generation redaction, including a log of the returned payload.
- Accessor rejection without getter execution, extra fields, invalid generation,
  tighter KV value limits and admitted failure results.
- Detached and deeply frozen raw-controller preparation, plus raw malformed,
  oversized and unknown-effect-index rejection.
- `insertIfAbsent` and `compareAndSwap` stored/conflict outcomes and malformed
  write-result rejection.

The MEM08 oracle now compares actual production with an in-memory diagnostic
that restores the former second normalization. Its v2 report uses `node` for
production and `legacy` for that comparison. Existing v1 evidence remains
historical. Both versions retain the same causal root-removal method; diagnostic
closed controllers are never resumed.

## Measured result

Node 24.19.0 / V8 13.6.233.17-node.51, seven bounded fixtures:

| Fixture | Production payload strings | Legacy payload strings | Production string self bytes | Legacy string self bytes |
| --- | ---: | ---: | ---: | ---: |
| 64 × 16 KiB text | 64 | 128 | 1,049,600 | 2,099,200 |

The production change removes **1,049,600 measured bytes of retained payload
strings** in this fixture. This is V8 string allocation evidence, not a total
process/RSS or throughput claim. The payload allocation closure remains
1,056,232 bytes for text and 873,960 bytes for 64 × 128 small records.

Production and legacy variants match complete responses, raw trace hashes,
continuation states, cumulative handles and PS3 charges. Failure, cancellation,
deadline and late-completion controls agree. After 1/4/16 completed requests,
tracked controllers and payload graphs are collectible even with caller-owned
result envelopes retained. All seven unchanged Fastly fixtures also pass the
oracle's response, hostcall, resource and accounting comparisons.

`mem09-normalization-evidence.json` is a projection of the accepted v2 report:
it retains source/toolchain identities, Node allocation/root observations,
parity outcomes and lifecycle controls; it omits process samples and detailed
Fastly allocator snapshots. Full measurements and raw heaps remain in the
ignored result directory. Production and harness SHA-256 identities in the
report identify the tested bytes despite the uncommitted tree at replay time.

## Reproduction and validation

```sh
npm run build
npm run maintainer:check
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile native \
  --profile javascript --profile conformance --report .test-results/mem09-portable-final.json
node wasm/scripts/run-wasm-tests.cjs --task payload-retention-mem08 \
  --report .test-results/mem09-memory.json
```

Memory replay: terminal passed, 1/1 selected task, seven fixtures on each target,
run `2026-09-26T18-10-45-119Z--11`. Full measurements are in
`wasm/.test-results/compiler-efficiency/mem08/2026-09-26T18-10-45-735Z/`.
The 62.42-second run duration is not a performance comparison with MEM08.

Development attempts are retained separately. The new fixture initially needed
an explicit string conversion for a Native log, the existing `invalid-value`
expectation for a nested accessor, and the correct `insertIfAbsent` method name.
A standalone suite task then failed the release shard-coverage check. The test
is now part of the existing Native task, with no shard or release-policy change.
The final full profile run validates that integration. The memory replay's
launch-time dirty listing predates this test-wiring adjustment; its measured
runtime and harness hashes match the final sources.

Accepted final checks: workspace build and maintenance checks passed; the combined
unit, native, javascript and conformance replay terminated successfully with
97/97 tasks passed. Run `2026-09-26T18-11-20-380Z--56`, report
`wasm/.test-results/mem09-portable-final.json`. No skipped or failed tasks.
The source hashes for the changed executable runtime and regression files are
included in the committed evidence projection.
