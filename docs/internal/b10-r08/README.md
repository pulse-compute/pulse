# B10-R08 — installed multi-origin qualification and overhead

**Installed and local Compute qualification passes; hosted acceptance remains
pending.** Issue [#407](https://github.com/pulse-compute/pulse/issues/407) stays
open. This is development evidence for the R07 implementation merged in
[PR #464](https://github.com/pulse-compute/pulse/pull/464), not a release seal.
Class: evidence. Entry point: `provider-fastly`. Additional owners are the
test registry/external-task classification, canonical Fastly capability guide,
its generated installed mirror, and this internal evidence directory.

## Tested source and installed boundary

Base/latest: `7659f51283bddf9465144b32716931a092b31003`, tree
`5d8d54880dcd2271cba1d685d479edc9fff83b09`. The final qualification ran on clean
commit `ca82faa94ba60fe832ae664dcac7c45c16ac5282`, tree
`917b8c6d52917f664343fb93c91fb7d06f4600da`. Subsequent changes only add this
internal note and its receipt. `proof.json` retains the exact six executable,
fixture, registry and canonical/generated guide input hashes, original receipt
digest, task reports and retry dispositions. A different final commit identity
must not be presented as the execution identity.

The explicit external `fastly-dynamic-backends-installed` task performs a fresh
workspace build, packs all 20 first-party candidates, and installs the exact
16-package public consumer closure outside the checkout. First-party package
resolution uses a task-owned read-only loopback registry, lifecycle scripts are
disabled, and every installed tarball file is verified before and after public
CLI compilation. Node/package/lockfile/tool and artifact digests are retained.
There are no new production dependencies. The task does not enter default or
release profiles and does not replace an installed feature gate or hosted proof.

The final runner completed both requested tasks in 130.049 seconds: the installed
gate in 129.885 seconds and suite-shape in 0.154 seconds. All eight matrix cells,
12 behavior checks and nine local cases passed. The final report has no active
children, retained task roots or remaining process trees. Consumer and temporary
directories were removed, local servers/engine stopped, installed bytes remained
unchanged, and the worktree was clean after qualification.

## Claims by execution lane

| Lane | Evidence |
| --- | --- |
| Native injected host | Actual installed Native Wasm, strict workspace ABI oracle; 1/4/16/32-member repeated/distinct origins, registration counts, reversed completion and insertion-ordered output. |
| Fastly JavaScript | Actual installed CLI-emitted application/provider closure executing on Node provider emulation. This covers application lifecycle, effects and codecs; it is not JavaScript Compute Wasm or an SDK/platform execution proof. |
| Local Compute | Installed Native capacity-32 Wasm on Viceroy 0.21.1; active prefixes of 1/4/16/32 members at one origin or separate independent listeners. All arrivals precede any completion, response-finish events run in reverse, and listener-specific bodies verify the actual physical destinations. |
| Hosted | Not run and not waived: authorized service, entitlement, public DNS/root TLS, platform limits, connection reuse and production registration timing remain required. |

Viceroy executable SHA-256:
`881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9`.
The pinned upstream/archive identity and ABI interpretation remain in
[`../b10-r06/README.md`](../b10-r06/README.md). No service was created, configured
or deployed.

## Artifact and registration overhead

Each row uses a separately compiled installed public handler with the stated
collection capacity. The disabled fixed control has one explicit static origin
mapping and the same collection bookkeeping. Dynamic and fixed artifacts are
compared at the same capacity; fixed execution is meaningful only for the
repeated-origin case. Distinct origins are never routed through a single static
backend as a purported equivalent control.

| Capacity | Dynamic Wasm bytes | Fixed Wasm bytes | Raw delta | Gzip delta | Repeated registrations | Distinct registrations | Committed linear memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 130502 | 124323 | 6179 | 2144 | 1 | 1 | 2621440 |
| 4 | 131441 | 125298 | 6143 | 2143 | 1 | 4 | 2621440 |
| 16 | 135152 | 129113 | 6039 | 2024 | 1 | 16 | 5242880 |
| 32 | 140009 | 133856 | 6153 | 2074 | 1 | 32 | 5242880 |

Every cell sends exactly its member count. Linear memory is the Wasm memory
buffer length after execution, not live allocations, engine RSS or peak memory.
The approximately 6 KB raw / 2 KB gzip increment is specific to these fixtures.
R07 retains the separate byte-identical disabled/no-use controls.

The receipt separates controlled execution timings from actual loopback round
trips. Controlled samples instantiate fresh Wasm and include guest execution
plus the strict JavaScript host, with no network. Eleven runs discard one warmup;
the recorded "median" is the upper middle sample (sorted index 5 of ten), not the
average of the two middle samples. These observations do not isolate platform
registration CPU. Local round trips include host, transport and the origin
barrier; subtracting them would not produce a registration benchmark. JavaScript
bundle sizes are 581981–581982 source bytes, not js-compute Wasm sizes. No latency
or memory performance guarantee follows from this run.

## Lifecycle, composition and public example

The 12 checks cover injected registration statuses 1/5/13, invalid URL, transport
failure, timeout, cancellation, empty collection, mixed static/dynamic selection,
schema/textResult composition, schema error recovery and the canonical public
example. Successful values and application recovery agree across Native and
JavaScript. Schema fixtures include nullable data, Unicode, middleware and
explicit text encoding, exercising the repaired R01 seam.

Default failure responses preserve current target behavior: Native returns
400/502/504 for invalid URL/network/timeout; the JavaScript contained lifecycle
returns 500. Public effect observations verify dispatched JavaScript error codes
`PULSE_FASTLY_FETCH_NETWORK`, `PULSE_FETCH_TIMEOUT` and
`PULSE_RUNTIME_EFFECT_ABORTED`. The invalid pre-construction URL has no exposed
code through that lifecycle; its checks assert 500 and no outbound dispatch.
Cancellation proves request/effect containment, not rollback of wire activity.
Injected registration statuses do not establish actual service entitlement or
platform exhaustion.

The ninth real local case executes the production TLS path against an untrusted
self-signed localhost leaf without a CA override. It returns 502, reaches no
HTTP handler and records `ERR_SSL_TLSV1_ALERT_UNKNOWN_CA`. Trusted public TLS and
hosted certificate/hostname failure behavior remain unqualified. The source-bound
two-origin example in the capability guide is compiled and run through both
installed paths; its fixture digest is retained.

## Reproduction and remaining acceptance

With restored lockfile dependencies, OpenSSL and an explicitly selected Viceroy:

```bash
PULSE_VICEROY_BIN=/absolute/path/to/viceroy R08_PROOF_FILE=/tmp/r08-proof.json \
  node wasm/scripts/run-wasm-tests.cjs --task fastly-dynamic-backends-installed --task suite-shape --report /tmp/r08-tasks.json
```

The task needs real full-workspace build and third-party npm dependencies; it
fails if the explicitly required local engine is absent. Its first-party package
registry and consumer are owned scratch resources. Final authority/feature
coverage controls also pass without changing release/shard definitions. Required
maintainer, documentation and documentation-release checks pass; no full unit,
complete release profile or seal pass is claimed. R07's reproduced Entities unit
baseline failure remains recorded, and R12 owns integrated-candidate validation.

Hosted acceptance needs an authorized Fastly test service and Dynamic Backends
capability, unavailable-capability diagnostics, public DNS and normal root-trust
TLS/hostname checks, real resource limits, connection reuse, production
registration timing and resource measurement. This can share the authorized
service window needed by R09's deployed log-tail proof. It is a required handoff,
not an acceptance waiver. No MCP implementation changed.

Historical attempts remain explicit in the receipt: initial suite classification
failure; an early passing run with weaker local ordering evidence; an incorrect
JavaScript diagnostic oracle failure; a passing strengthened run; then the final
committed run with independent listener identity and explicit execution lanes.
The fixes changed the test classification/oracle, not production behavior or
the hosted acceptance requirements.
