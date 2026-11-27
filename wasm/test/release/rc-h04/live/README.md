# RC-H04 deployed proof

The owner instructed “Proceed with the proof” after the initial blocked
checkpoint. This authorized the required isolated QA services, product enablement
under existing entitlements, stores, scoped object credential, bounded traffic
and cleanup. No existing production service was changed. The original temporary
management token remains active by prior direction and is excluded from evidence.

## Exact candidate

- Source: `d012f547f804af6e272cb1a6aeafe970c22e0b77`.
- Tree: `ae28b53c6a31c77354e06d1e2d8816139b329eb2`; clean checkout.
- Installed bundle: `9df4b0c7e407ca5d8fad267efa216e88ec78b874879307330b7824210a84d697`.
- Node 24.18.0, npm 11.15.0, pnpm 12.4.2.
- All 20 installed packages match the initial local K4 package hashes. Full
  installed file closure was verified before and after both new fixture builds.

`evidence.json` binds every retained receipt, harness and deployed package archive
by SHA-256. `packages/` contains the exact seven Compute packages submitted to
Fastly. The two additional VCL services were isolated probe relays, not Pulse
product deployments. Later evidence commits do not change the identities above.

## Terminal transport

The [CI local run](https://github.com/pulse-compute/pulse/actions/runs/45882718724)
passed 15 cells with pinned Viceroy 0.18.0 and Pushpin 1.42.0. Its retained bundle
was deployed unchanged to five isolated Compute services. `terminal-hosted-4.json`
passed all 15 hosted cells: ordinary responses, Fanout handoff/hold/publish and
bidirectional two-frame WebSocket echo, including the independently named package.
`terminal-qualification.json` verifies both complete matrices against the same
installed receipt and artifact hashes. Service versions, domains and Fastly files
hashes were inspected before and after traffic.

Attempts 1–3 are retained. Attempt 1 rejected an incomplete deployment config
before traffic. Attempt 2 passed 13 cells before the newest Fanout route returned
502; read-only readiness later observed the expected origin response. Attempt 3
passed 14 cells before a held response timed out. Its cause is not established.
Attempt 4 replayed the entire unchanged matrix and passed; no cell pooling,
assertion relaxation or timeout increase was used. `terminal-fetch-trace.json`
records the winning attempt's request timing without credentials or bodies.

## Cross-location conditional KV

The exact installed K2 command consumer has a QA secret check before dispatch.
Response-only AssemblyScript instrumentation reads `FASTLY_POP`, service ID,
version and trace ID through WASI. The KV implementation and operations remain
unchanged. Both original and instrumented source/module hashes, exact compiler
arguments and the consumer source are retained. The instrumented artifact ran
all 171 local corpus requests with only the existing Viceroy missing-key failure.

Two isolated VCL relays use shield-first service chaining to the same Compute
service: IAD and LHR. The target's own runtime POP identifies execution; a shield
label or caller header is not accepted as location evidence. Package and KV
binding inspection ties that runtime identity to the exact module and store.
The unchanged `wasm/test/kv/k4/deployed.cjs` accepted 58 requests:

- Three concurrent create/CAS schedules, each with exactly one acknowledged
  winner and one conflict at both stages.
- Cross-location value/generation observations within the existing 30-second
  read budget, stale/missing exclusion and retained conditional tombstones.
- A local controlled relay dispatched one remote create, discarded its response
  body and reset the client connection. Independent service-side metadata was
  retained; both locations subsequently observed the committed receipt.
- Zero mutation retries. Client response loss is not a fabricated typed KV
  `unknown` acknowledgement.

The first attempt timed out on the second admission read before any writes.
Its receipt/log remains separate from the complete passing attempt. The driver
preserves unique request IDs, rejects changed POPs and uses the existing
15-second invocation deadlines. After the proof, administrative reads confirmed
four retained tombstones before owner-scoped teardown; that teardown is not an
additional durability or CAS qualification claim.

## Live origin and S3

`origin-proof.json` passed 16 cases through one installed, uninstrumented Native
fixture. It covers `putText`, `head`, `getText`, opaque `getBody`, binary fidelity,
range/conditional responses and absence. One deterministic binary overwrite was
performed with a direct signed fixture request so opaque reads could be tested;
that setup is explicitly not Pulse upload support.

GET, DELETE and OPTIONS each reached the controlled origin once. Collected
header timeout and network failure returned their typed outcomes. Observed guest
fetch timing was approximately 401 ms for a 400 ms header deadline and 2,072 ms
for the delayed body; the header-only response reached the client in 367 ms.
These are individual observations, not percentile or latency guarantees.
`controlled-origin-requests.log` independently records the six expected origin
requests, including exactly one timeout dispatch and two delayed-body requests.

The credential-free [origin workflow](https://github.com/pulse-compute/pulse/actions/runs/45887243043)
used a pinned cloudflared executable and the exact terminal origin source. It
stopped on the committed stop signal and completed cleanup successfully. The
workflow exists only on `evidence/rc-h04-live-origin`; its retained definition is
under `harness/`, not added to normal repository automation.

## Cleanup and reproduction

`cleanup.json` verifies nine deleted service records with no active/deployed
versions, two absent stores, four exact KV key deletions, one exact S3 object
removed and observed absent twice, and revocation of the bucket-scoped object
credential. Fastly retains HTTP-200 service tombstones with `deleted_at`; the
initial 404-only teardown verifier failed and was replaced by a read-only
verification of that actual API behavior. No deletion was repeated to fix the
observation. The existing bucket and unrelated resources were left intact.

The executed harness is retained with its explicit `/tmp/rc-h04-live` scratch
layout. `control.py` reads the management key from a private `api-key` file and
persists owned resource identities/private credentials in mode-0600
`resources.json`; those files are never evidence inputs for publication. Use
fresh output paths, scoped resources and the exact installed bundle when
reproducing. The producer scripts distinguish direct fixture setup from Pulse
operations. Preserve failed attempts, and inspect partial resource state before
resuming provisioning rather than blindly rerunning creation commands.

The initial fixture authoring failures are retained too: a non-admitted dynamic
S3 validator, unsupported key-prefix method, misplaced local manifest and an
omitted VCL snippet `dynamic` field. Corrections changed test setup only. The
public admission rules, production code and release assertions were preserved.
