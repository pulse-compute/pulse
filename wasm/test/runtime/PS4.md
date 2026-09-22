# PS4 packed qualification and adoption

Status: **PS4 locally qualified; review and merge pending**.
Production acceptance and Catalog step 16 remain open.

The initial qualification used merged PS3 commit
`97dce5734fc0f3916f44a520e37200295a2ad920`. Follow-up fixes and their separate
packed source identity are described below. Original failures are preserved;
no historical result is relabeled as passing.

## Passing loop lanes

`assert-read-loop-packages.cjs` passes 53 checks: Node Native, Node JavaScript,
and the Fastly ABI fixture cover S3 and KV traversal, zero/one/exact-64 bounds,
65-page and cyclic incompleteness, two awaits per iteration, pure inner loops,
continue/break, early return and storage failure. Node lanes additionally cover
cumulative effect/deadline budgets, abort and late success/failure. Product
behavior is loaded from the installed packages; the allowlisted source imports
are test-only Fastly authorities. The clean-machine suite now runs this gate.

`assert-read-loop-reality.cjs` separately passes ten cases under Viceroy 0.21.0:
zero, one, four and 64 pages; early return; 65-page and cyclic incompleteness;
missing/failed storage and malformed JSON. A local HTTP object origin records
the exact ordered read count. This proves actual local engine execution of the
packed Fastly Native artifact, not deployed Fastly behavior or conditional KV
K4 acceptance. The emitted Wasm is 123,729 bytes, SHA-256
`6a091a2af826a0dd0717338146c87d75abd70c5dc20ceb8c50b0b880aaebcc77`.

```sh
env -u NODE_PATH node wasm/test/release/assert-read-loop-packages.cjs "$INSTALL" "$PACK"
env -u NODE_PATH PULSE_VICEROY_BIN="$VICEROY" \
  node wasm/test/provider/assert-read-loop-reality.cjs "$INSTALL" "$PACK"
env -u NODE_PATH node wasm/test/runtime/reproduce-read-loop-adoption.cjs "$INSTALL" "$PACK"
```

Use an isolated consumer with an explicit `workspaces: []` root. `$PACK` contains
the pack manifest and tarballs. The reproduction must exit successfully with all four rows passing. No full clean-machine replay is claimed by these
focused executions.

## Adoption regression and fixes

The original reports remain unchanged in `evidence/ps4-*.json`. Both Native
Catalog runs originally stopped after 258 checks at a lifecycle command with a
valid 4,000-character escaped note. Node reached its 64 MiB retention budget.
The reduced pure-request reproduction separately showed repeated scalar reads
exhausting Node's 1,048,576 retained-value units when an unused read-loop route
activated the request budget. Fastly passed that reduced reproduction.

Node now maintains bounded request-local indexes for 8,192 scalar handles and
8,192 object/array identities. Scalar mappings rotate as the working set changes.
Index capacity is charged once as it grows; every allocated value handle stays
retained and charged. Object aliases reuse an existing handle, while different
objects remain distinct. Negative zero remains distinct from positive zero.
Guest mutations are still charged before writes, and cached reads still check
terminal failure. Tests cover index bounds, capacity reuse, aliases after index
eviction, distinct objects, mutable aliases, settlements and cancellation. No
collector, handle reclamation, ABI change or increased limit is introduced.

Full Catalog diagnosis also found quadratic application text copying. Its
lifecycle serializer removed JSON braces one character at a time. Fastly's
retention diagnostics identify error 1010/stage 172 (byte ceiling), with about
64.9 MB charged to retained string-concatenation prefixes. Its analytics scanner
had the same pattern when preserving raw event identity. The application fixes
assemble 64-code-unit chunks while preserving original bytes and the existing
input/work bounds. Analytics combines chunks through fourteen fixed binary-carry
levels, appends to owned arrays, hoists invariant page offsets and resets its
event-local counters at each event root. Exact-byte and capacity boundary tests
cover the resulting admission behavior. The Fastly provider's product implementation is unchanged.
The maintained packed fixture adds an escaped-text copy case on all three
lanes; application-specific fixes and raw reports remain in the Catalog snapshot.

`evidence/ps4-fix3-adoption-reproduction.json` records four passing reduced
reproduction rows. `evidence/ps4-fix3-packed.json` records 53 passing checks;
`evidence/ps4-fix3-viceroy.json` records ten local-engine cases. The clean-machine
suite now enforces the reduced adoption reproduction as well as packed parity.
Full Catalog qualification is recorded in
`evidence/ps4-fix-catalog-summary.json` and the accompanying Catalog snapshot.

The packed product source tree is `548afc509bd9f9f89cf9861c8afa5809b7c53089`.
The local commit recorded during packing, `1eac81ee606a1be20e93a8744fc5deec2db8036a`,
and GitHub commit `1c8fe4f39c07397b6f0767561be88f662defe2ed` have that same tree;
their commit metadata differs. Raw reports retain their original identities.
Later changes in this PR add tests, documentation and evidence only. Package
labels remain unpublished beta.5; all 19 tarballs and installed closure hashes
identify the actual bytes. No installed product files were edited during tests.

## Catalog qualification

The final unmodified packed candidate passes all 324 Catalog checks on each of
Node Native, Fastly Native and JavaScript, plus nine browser workflows. This
includes the original lifecycle failure, 500-event analytics admission, replay,
recovery and administration receipt archiving. Node's peak accounted retention
was 31,988,828 bytes; Fastly's peak linear memory was 192,937,984 bytes, below its
256 MiB cap. These are different measurements, not cross-runtime comparisons.

All 584 application unit tests and generated/layout checks pass. The readiness
assessment confirms valid local evidence while retaining all six step-16
requirements and the pending merged-toolchain requirement. Migration and
production readiness remain false. The selected Pulse profiles, pack,
reproduction and policy results are identified in the qualification summary.

The Catalog snapshot preserves every original evidence file, intermediate
failures and diagnostic experiments. Final qualification uses the unmodified
installed packages, without diagnostic runtime overrides. All 979 installed
file hashes remained unchanged. Application-specific fixes are included as
canonical source changes, regenerated outputs and a patch against the prior
snapshot.

## Other observations and limits

The Viceroy fixture sends `x-stop-before: never` explicitly. Viceroy 0.21.0's
`fastly_http_req#header_value_get` maps a missing header to INVALID_ARGUMENT,
whereas the current test ABI/Pulse path expects NONE. An absent optional header
initially produced an empty 200 with no reads. This fixture does not qualify that
preexisting mismatch. See the pinned engine's
[adapter source](https://github.com/fastly/Viceroy/blob/v0.21.0/wasm_abi/adapter/src/fastly/core.rs).

Malformed JSON is handled by an explicit three-argument Router error handler
returning 503. Without it, the fixture returned empty 200; no uniform default HTTP
exception behavior is promised or introduced. Earlier failed fixture attempts
are retained in the Catalog evidence snapshot alongside terminal reports.

The original browser attempt was incomplete (seven of nine checks). The harness
now fails incomplete runs and bounds browser waits; its exit guard has a
fault-injection test. The final run completed all nine workflows. Prior browser
evidence is not relabeled for changed sources. Receipt continuation for other
aggregates, whole-history indexes, taxonomy coordination, migration and deployed
identity/recovery remain separate Catalog step-16 requirements.
