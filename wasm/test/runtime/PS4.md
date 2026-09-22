# PS4 packed qualification and adoption

Status: **loop qualification implemented; Catalog adoption blocked**.
This does not close PS4, production acceptance, or Catalog step 16.

The measured package source is merged commit
`97dce5734fc0f3916f44a520e37200295a2ad920`, tree
`8b8f74503159caf8f6b1d00b4762705f00cbe71b`. Nineteen packages were built and
packed by `scripts/pack-release.cjs`, then installed outside the checkout.
Their beta.5 labels are not published-version evidence. The reports retain
archive hashes; the supervisors compare installed closure bytes before and
after execution. No product package source was modified for PS4.

## Passing loop lanes

`assert-read-loop-packages.cjs` passes 50 checks: Node Native, Node JavaScript,
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
the pack manifest and tarballs. The reproduction's exit 1 is an adoption blocker,
not a passing release gate. No full clean-machine replay is claimed by these
focused executions.

## Catalog gate and reduced reproduction

The restored administration archive candidate retains its 64-receipt online
tail, content-addressed pages, digest/revision checks, exact replay and current
authorization checks. A retained revision floor prevents premature chain
termination from masquerading as absence. Recovery includes archive pages and
original results. The broader JavaScript corpus completed 324 checks.

Both Native Catalog runs stopped after 258 checks at the existing lifecycle
command with a valid 4,000-character escaped note. Node reported the 64 MiB
retention ceiling (67,098,936 charged bytes and 887,954 units before rejection).
The older Catalog Fastly test host reported `unreachable` with 24,117,248 bytes
of linear memory; its precise trap is not diagnosed as a memory failure here.
These failed reports remain evidence, not qualification.

`reproduce-read-loop-adoption.cjs` removes Catalog, schemas, authentication and
storage from the executed request. The same bounded 64-by-1024 pure computation
returns 65536 on both Native targets without a read-loop route. Adding an unused
read-loop route makes Node reach 1,048,576 charged value units and fail closed
(33,358,498 bytes); Fastly still passes this reduced case. Thus application-wide
activation of cumulative retention creates a confirmed Node adoption regression,
while the larger Fastly failure remains separately unresolved.

PS3's isolated full-artifact receipt measurement did not qualify unrelated
requests. Do not raise the cap or reduce valid Catalog input limits to call PS4
complete. The next work is bounded value-lifetime/accounting improvements that
preserve aliases, settlements and return roots, plus diagnosis of the full
Fastly request. Rerun this reproduction, PS3 containment/alias tests, packed
parity and all Catalog target/browser gates before adopting the archive. A
general collector or versioned ABI redesign remains a separate design decision.

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

The current browser attempt was incomplete (seven of nine checks); prior browser
evidence is not relabeled for changed sources. Receipt continuation for other
aggregates, whole-history indexes, taxonomy coordination, migration and deployed
identity/recovery remain separate Catalog step-16 requirements.
