# OPS-01 operational acceptance

Status: implementation and local rehearsal; live acceptance is **pending**. No
service was deployed or activated by this work. The supported composition is the
private MCP resource-directory app on Node JavaScript and existing example 01
on Node Native. Fastly/Native MCP, provider reality, a release seal and production
issuer qualification are not claimed.

## Prepare and rehearse

```sh
node wasm/scripts/run-wasm-tests.cjs --task ops01-exercise --no-report
node wasm/scripts/run-wasm-tests.cjs --task ops01-installed --no-report
```

The installed task packs exact current candidates, installs the MCP app outside
the checkout with lifecycle scripts disabled, and verifies installed Pulse
package bytes. It builds both apps through ordinary `pulse build`, copies the
runnable builds and the complete installed dependency closure into immutable
candidate directories, and seals every regular file by path, length and SHA-256.
The inventory rejects symlinks and caps the closure at 512 MiB / 20,000 files.
The retained npm lock and exact Pulse package hashes distinguish the candidate
from other packages with the same beta version. The adapter remains private.

The baseline is a **synthetic rehearsal revision**: only the directory tool's
title and the hello response differ. The candidate uses the unmodified example
sources. This proves artifact switching and rollback mechanics; it is not an
upgrade from a previously deployed release. A live exercise must supply the
actual accepted predecessor, never this synthetic baseline.

The rehearsal runs the public `@pulse-compute/provider-node/server` integration
on both targets, not `pulse dev`. The independent client is
`@modelcontextprotocol/client@2.2.0`, using MCP `2026-07-28`. It verifies auth
challenge, filtered discovery, denied proposal, invalid input, search, retrieve,
a single admitted proposal without resource mutation, and the Native consumer's
health/hello/not-found routes at baseline, candidate and rollback. The controlled
issuer and credential-checking backend proxy remain test fixtures. The bounded
in-memory directory survives host replacement during this exercise; it does not
gain persistence across its own restart.

Each phase reads the selected active artifact's entire file list and actual
bytes and compares them with the sealed candidate, then checks active identity
after wire acceptance. The operator driver is the trust boundary that ties
these reads to the active process. A caller-supplied hash alone is insufficient;
the nonce is a freshness check, not cryptographic remote attestation.

The runner does not retry activations or proposals. If candidate verification or probing fails after activation settled, it attempts
the exact predecessor rollback once. An activation error or timeout has unknown
disposition: rollback is blocked until the operator resolves it.
A passing rollback does not erase the failed candidate. Failed rollback remains
a failed exercise. Each activation and each verification/probe phase has a
finite timeout (30 seconds by default, at most 120 seconds); timed-out writes or
activations have unknown disposition. Drivers must honor cancellation and must
not leave a background candidate activation that can supersede rollback.

## Retained handoff

`wasm/.test-results/ops01-installed-*/` retains:

- `ops01-installed-acceptance.json`: exact source/tree, working-tree state,
  package hashes, install verification, artifact inventories and terminal result;
- `exercise.json`: all three phase outcomes, file verification counts, active
  generation IDs, completed wire checks and owner-assigned findings;
- `candidates/candidate/` and `candidate.json`: runnable candidate and inventory;
- `candidates/baseline-rehearsal/` and its inventory: explicitly synthetic input;
- `candidates/packages.json`: exact package provenance;
- `client/`: frozen SDK client and replay runner.

The local report always says `deployed: false` and `liveGate: pending`. Preserve
failed attempts separately. The files are local preparation artifacts; archive
and retain them with the reviewed deployment record before an operator starts a
live exercise. Do not store credentials inside these directories.
Reports keep `liveGate: pending` even after a passing deployed smoke; the separate
`deployedSmokeStatus` records that bounded result. Issuer qualification and live
fault observations still require the owners below before OPS-01 can close.

## Reviewed live driver

No deployer or environment is guessed. An operator supplies an external ESM
module exporting `createExercise()`, returning:

```js
{
  baseline: { root: '/accepted/predecessor', manifest: predecessorInventory },
  candidate: { root: '/reviewed/candidate', manifest: candidateInventory },
  timeoutMs: 60000,
  driver: {
    mode: 'deployed',
    activate: async ({ name, revision, signal }) => { /* approved supervisor */ },
    inspect: async ({ nonce, signal }) => ({ instanceId, artifactSha256, nonce }),
    readActiveFile: async (name, { signal }) => { /* names for null; Buffer otherwise */ },
    connection: async ({ signal }) => ({ mcpUrl, helloUrl, readerToken, writerToken }),
    close: async () => { /* release control/probe handles; never silently redeploy */ }
  }
}
```

`activate` selects only a reviewed immutable revision, waits for actual readiness
and drains the replaced generation. `inspect` must obtain active runtime identity
from the deployment control plane. `readActiveFile` must enumerate/read the
closure actually selected by that process, including dependencies; it must not
read the local expected candidate. An authenticated snapshot of the active
closure may be fetched once per phase and served to the verifier. Bind it to the
active instance observed before and after the probe. Review the driver source
and its operator access before accepting its observations.

`connection` returns fixed HTTPS MCP and representative-consumer URLs, with
separate read/propose grants from the selected external issuer. Tokens stay in
memory and are never written to the report. The client rejects redirects and
credential destinations other than the selected MCP endpoint. Live mode rejects
loopback configuration. The approved test account may submit **three proposals**
(one per phase); it must not authorize accepting those proposals as resource
edits. The deployment operator owns fixture data disposition.

After explicit authorization for the selected isolated environment and the
baseline/candidate IDs, copy the retained client directory outside the checkout, install its frozen
SDK dependencies with lifecycle scripts disabled, then run:

```sh
node ops-run.mjs --live-driver /private/reviewed-ops-driver.mjs /evidence/new-ops01-live.json
```

The runner refuses to overwrite a previous report. It has no default live driver,
credential lookup, service discovery, package publication or Fastly activation.
There is no automated production rollback after an unknown remote disposition;
the selected supervisor must serialize activation and resolve that uncertainty.

## Findings and remaining gate

| Item | Owner | State / exit |
|---|---|---|
| Production Node composition and artifact rollback | Pulse maintainers | Local installed rehearsal; retain terminal report |
| Isolated host, two HTTPS URLs and actual predecessor | Deployment operator | Pending selection and explicit activation/rollback authorization |
| External issuer, read/propose principals and confidential introspection | Identity operator | Pending live configuration; fixture issuer is not evidence |
| Private backend ingress, TLS and host limits | Deployment operator | Verify in the chosen environment before probe writes |
| Active artifact/process binding | Deployment operator | Reviewed driver must read actual active files; supplied hashes alone do not close the gate |
| Backend failure, deadline/cancellation and recovery in deployed ingress | Deployment operator + Pulse runtime | Existing MCP-05 local evidence retained; controlled live fault window remains pending |
| Proposal persistence / cleanup | Application owner | Demo is ephemeral; select durable service if required; no rollback of accepted writes is promised |
| OPS-01 completion | Human maintainer | Passing exact live phases plus owned live findings; do not close from rehearsal alone |

## Performance reference from latest

The optimization lane inspected was `aa0ba50035d587b98ea5d5d578efc6563dee2b6b`.
Its retained O-25 clean proof at
`wasm/test/runtime/compiler-efficiency/o25-unblocked-evidence/proof.json` measures
source `8c1c8e1ccbe5b094012c6440935bc462e4b34af3`:

| Shared-helper calls | Native Wasm bytes | Native build milliseconds |
|---|---:|---:|
| 1 | 63,876 | 3,001.81 |
| 16 | 75,280 | 3,278.54 |

These are the optimization lane's historical synthetic measurements, not OPS
latency or deployment budgets. No optimization was ported and no benchmark sweep
was run here. Operational observations must bind latency/memory to the actual
deployed artifact and environment; do not apply these numbers as universal
regression thresholds. New tests here cover only the new operational runner.
