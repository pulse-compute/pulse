# RC-H02 — HTTP and effect boundary hardening

Development audit on `latest` base
`111aeaccab962bac547ed95c7797052fdc5cd983` (RC-H01 merged), branch
`hardening/rc-h02-http-effects`. This implements the release owner's RC-H02
request under the `runtime-effects` entry point, with API installed-consumer
and Fastly fixture coverage plus the corresponding changelog synchronization.
The scope is defect repair and hardening of existing supported behavior.

## Finding and repair

The canonical continuation host accepted malformed fetch inputs that the
JavaScript runtime rejected: falsy explicit methods became GET, non-string
header values were coerced, malformed tuples and invalid header bytes reached
provider dispatch, and non-record init objects were accepted. It also added a
second content type when JSON had an explicitly empty content-type header.

`host-runtime/src/runtime/canonical-api-runtime.js` now validates ordinary init
records and header records/pairs before dispatch, defaults only an omitted
method, and uses header presence to select the JSON content-type default.
Validation preserves pair order, duplicate headers and explicit values. Header
errors do not include supplied values. No public export or dependency is added.

The registered `canonical-api-runtime` task now runs the admission regression:
21 invalid inputs against both normalizers, 20 serializable invalid inputs
through a compiled continuation program with zero provider calls, and a fresh
valid OPTIONS execution. Sparse header arrays are included. DELETE/OPTIONS
with JSON preserve an explicit empty content type and repeated pairs.

## Audit matrix

| Boundary | Evidence and result | Qualification limit |
| --- | --- | --- |
| Method admission | New admission regression; existing fetch-method parity corpus; installed runtime types and six real HTTP DELETE/OPTIONS cells (no body, UTF-8 text, JSON) | Installed runtime package only; not the complete installed CLI/compiler/provider candidate |
| Header and framing behavior | Fastly HTTP/platform generators exercise all five body-capable verbs, record/tuple/duplicate/empty content types and invalid pre-allocation admission; installed Node HTTP asserts exact bytes and byte content-length | Fastly emitted Wasm uses injected ABI; generic HTTP normalization remains provider-owned |
| Buffered ingress | `http-input-outcomes`, `request-budget-transport`: bounded UTF-8, declared/measured size, denial versus post-dispatch uncertainty and shared request budget | Selected adapter cases, not exhaustive hostile HTTP parser coverage |
| Opaque ownership and forwarding | `canonical-opaque-node-emission`, `fetch-projections-request-bodies`, `fastly-incoming-body-forwarding`: exact binary bytes, no implicit reads, framing denials, bounded buffers, late-body cancellation, disconnect and fresh execution | Node has real local HTTP evidence; Fastly forwarding is injected ABI, with host queue bound unmeasured |
| Deadline precedence | Runtime deadline/outcome/timing tests; request-budget tasks; 103 Fastly emitted-Wasm deadline cases | Preserve documented target-specific timer lifetimes; Fastly live replay not selected |
| Cancellation and late completion | Continuation registry, JavaScript effect adapter, canonical Native/runtime tasks: single settlement, no late resume/checkpoint, disposal and fresh execution | Best-effort cleanup is not remote rollback or proof of provider cancellation |

The member timer still ends at headers on ordinary JavaScript and Fastly Native
fetches; Node Native structured fetch includes bounded provider body acquisition.
Request expiry remains terminal and outranks member recovery when both are
expired. Fastly pending-request retirement cannot cancel already-sent remote
work. No implicit retry, broader timeout policy or fallback is introduced.
The authoritative contracts remain
[`effects-and-continuations.md`](../../../../docs/concepts/effects-and-continuations.md)
and [`bodies.md`](../../../../docs/concepts/bodies.md).

## Validation and provenance

`evidence.json` records development attempts, terminal task coverage and changed
source file digests. These checks ran on the base plus uncommitted development
edits; a report's `sourceRevision` alone is not the tested tree. Earlier runs
preceded the final sparse-array guard; the final canonical-runtime rerun covers
that guard. The PR head binds the resulting committed tree and subsequent CI.
These records are not resumable release checkpoints or a release seal.

Preserved failures: the admission test failed before the repair; the first
`api-surface` attempt failed because the new consumer test expected a rejected
promise instead of the runtime's managed HTTP 500 response. Correcting that
assertion retained the zero-dispatch requirement; the rerun passed. Tests did
not change the runtime's managed error policy.

Focused commands (run from repository root):

```sh
node_modules/.bin/vitest run packages/runtime/test
node wasm/scripts/run-wasm-tests.cjs --task api-surface --task canonical-api-runtime --task continuation-registry --task request-budget-transport --task http-input-outcomes --task canonical-opaque-node-emission --task javascript-effect-adapter --task canonical-api-lowering --task canonical-native-wasm --no-report
node wasm/scripts/run-wasm-tests.cjs --task fetch-projections-request-bodies --task fastly-native-http-effects --task fastly-incoming-body-forwarding --no-report
node wasm/test/provider/assert-fastly-fetch-headers.cjs platform
node wasm/test/provider/assert-fastly-fetch-deadlines.cjs
```

## Remaining RC gates

RC-H03 still owns full clean installed-candidate acceptance with exact packed
CLI/compiler/provider bytes. RC-H04 owns candidate-specific deployed provider
proof or an explicit owner disposition. RC-H05 owns release identity, freeze and
aggregate qualification. This pass neither republishes beta.11 nor qualifies
uploads, S3 additions, OpenAPI export or new timeout controls.
