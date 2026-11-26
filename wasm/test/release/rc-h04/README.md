# RC-H04 — provider qualification checkpoint

Status: **blocked; owner disposition or the remaining deployed proof is required**.
The release owner requested RC-H04. This checkpoint records current-candidate
observations and concrete remaining gates; it does not close RC-H04 or seal RC1.

## Candidate and scope

The tested clean source is `a25052124cb670108eecce1710f93c2fb60fd84a`,
tree `edf7b89884e02160e5608891c831296a91d09011` (merged RC-H03).
Node 24.18.0, npm 11.15.0 and pnpm 12.4.2 built and packed all 20 packages.
The inherited beta.11 version is development metadata, not newly published
beta.11 bytes. `shared-pack.json` binds the exact package archives. Installed
terminal and K4 consumers used verified copies from that one clean-source pack.

`evidence.json` inventories retained receipts and hashes. These are focused
qualification attempts, not a resumable aggregate release seal. This evidence
commit and the transport runbook are later additions; none of the receipts is
rewritten to claim execution on those additions. CI's terminal workflow qualifies
its own exact source and installed bundle; its artifacts must be read as a
separate candidate, not pooled with this checkpoint.

## Observations

| Lane | Result and boundary |
| --- | --- |
| Generic Compute reality | Passed with Fastly CLI 16.1.0; an explicit Viceroy 0.21.1 replay binds the engine bytes |
| Dedicated local K4 | See `k4-pinned.json`: raw semantics and the separate existing release disposition are retained verbatim |
| Installed terminal bundle | Passed: 20 package closure, eight Wasm/report pairs, 15 negative admissions and 20 injected ABI cases |
| Terminal real local transport | Blocked before traffic: initial missing ICU 74 library restored; unchanged retry reached Pushpin and failed with `Operation not permitted` in its socket setup; both attempts cleaned up |
| Fetch deadline real-engine replay | Passed 103 emitted-Wasm ABI assertions and nine local HTTP cases on pinned Viceroy 0.18.0, including timeout recovery, no retry and early header acknowledgement |
| Current-candidate hosted terminal | Not run; needs the controlled reachable HTTP/WebSocket/GRIP origin and five scoped deployed fixture identities |
| Current-candidate deployed K4 | Not run; no reviewed T2 driver supplying independent probes with verified distinct execution POPs |
| Current-candidate live origin/S3 and hosted fetch | Not run; these have no new deployed receipts in this checkpoint |

The first K4 attempt used CLI-managed Compute without a recorded Viceroy
identity. It correctly failed acceptance despite reproducing only missing-key
CAS: an unidentified engine cannot receive the narrow known-engine disposition.
The second attempt explicitly selects the hash-verified Viceroy 0.21.1 executable
and repeats the complete unchanged selection. Retain the first failure; do not
turn it into a passing result retroactively.

The October 4 standing exception recognizes only the exact missing-key CAS
observation on Viceroy 0.21.0/0.21.1. It does not waive another race failure or
current deployed cross-location K4. Beta.6/beta.10/beta.11 candidate-specific
exceptions and #571's hosted terminal success do not transfer to this source.

The existing temporary QA API credential was confirmed valid during preparation;
its value is excluded from evidence. Credential availability does not provide
a reachable controlled origin or independent remote probe transport. No external
service, key, store or object was created or changed in this checkpoint.

## Reproduction

With the pinned Node toolchain and clean tested source:

```sh
node scripts/pnpm-toolchain.cjs -- run build
node scripts/release-shared-pack.cjs --out .pulse-release/rc-h04-shared
```

Supply `sharedPackEnv('.pulse-release/rc-h04-shared')` from
`scripts/release-shared-pack.cjs` to the installed consumers. Set
`PULSE_FASTLY_BIN` and `PULSE_VICEROY_BIN` to the verified CLI 16.1.0 and
Viceroy 0.21.1 binaries. Use a fresh absolute report path:

```sh
node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-compute-reality --task kv-conditional-acceptance --report /absolute/path/provider.json
node wasm/test/qualification/terminal/prepare.cjs /tmp/fresh-terminal-bundle
```

Follow the [terminal transport runbook](../../qualification/terminal/README.md)
for local engines and hosted fixture inputs. On a host that permits Pushpin's
required sockets, execute the entire 15-cell local matrix. Do not alter its
assertions or engine pins to turn this environment failure into a pass.

The fetch deadline replay uses the repository harness and terminal-pinned
Viceroy 0.18.0 with `PULSE_VICEROY_BIN` set:

```sh
node wasm/test/provider/assert-fastly-fetch-deadlines.cjs
```

That harness creates a temporary project in the checkout. Run it separately
from clean-source packing/installed admissions. Its complete source is removed
in `finally`; this run returned to a clean checkout.

## Exit decisions

Before closing RC-H04, supply and execute the missing current-candidate proof,
or record a new explicit release-owner disposition naming this source and each
accepted gap. Required inputs are:

1. A host permitting the pinned Pushpin transport matrix (the existing terminal
   CI workflow is suitable), plus a controlled origin reachable by deployed
   Fastly for HTTP, WebSocket echo and GRIP hold/publish.
2. Scoped package/version/domain configurations for the five terminal fixtures;
   the hosted runner verifies artifact identity before and after traffic.
3. The reviewed isolated K4 environment and `createProbes()` driver described
   in [K4](../../kv/K4.md), with two independent verified execution POPs and the
   controlled lost-response transport. Caller-supplied POP labels do not count.
4. Fresh intended-origin/S3 and hosted fetch outcomes/timing receipts for this
   candidate, including resource identities and exact-key cleanup.

RC-H05 remains separate: choose the release version, freeze the final source and
run its complete aggregate and installed acceptance gates. A green evidence PR
or local acceptance disposition alone does not authorize that release.
