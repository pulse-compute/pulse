# beta.11 hosted-provider qualification handoff

Status: blocked on actual T2 infrastructure and probe transport; no deployed beta.11 result claimed. The token used for earlier #571 qualification is not embedded here.

## Frozen candidate

Review/tested merge source `67c984d8dc223dd94d1146353534b12a89e0e50b`, tree `77e58f4f93bf3f90d1f3390423218bc6d8a20462`, PR [#591](https://github.com/pulse-compute/pulse/pull/591). Keep every deployed Wasm digest, deployment receipt and installed-package receipt bound to the exact selected candidate. Stop and reconcile if that candidate changes.

## Evidence inventory

| Capability | Retained evidence | Current disposition |
| --- | --- | --- |
| Terminal WebSocket/Fanout #571 | 15/15 installed local cells and 15/15 hosted cells, aggregate verification and external cleanup; original clean head `81c9952e6cc13810957b0a5ade0a34b04ff5daa0` | Merged; original source binding retained. Not recast as a current beta.11 deployment. |
| Local K4 conditional KV/CAS | Exact-candidate supplemental run 41301552370, known Viceroy 0.21.1 missing-key CAS discrepancy explicitly retained | Local acceptance only under standing disposition; deployed cross-location proof remains required. |
| Deployed Pulse cross-location KV/CAS | No current candidate-bound T2 driver/probe run available | Pending infrastructure below |
| Deployed stdout/log-tail (#309) | Prior beta.10 exception was candidate-specific | Current proof or explicit beta.11 owner disposition pending |
| Dynamic backend (#407) | Prior beta.10 exception was candidate-specific | Current proof or explicit beta.11 owner disposition pending |
| Named production logging destination (#467) | Prior beta.10 exception was candidate-specific | Current proof or explicit beta.11 owner disposition pending |
| KV list/delete (#468) | Prior beta.10 exception was candidate-specific | Current proof or explicit beta.11 owner disposition pending |

No beta.10 waiver is inherited. The [beta.10 ledger](https://github.com/pulse-compute/pulse/blob/67c984d8dc223dd94d1146353534b12a89e0e50b/docs/internal/beta10/README.md) records the historical limits. The user chose to address the gaps; this packet does not create a new waiver.

## Required T2 inputs

The canonical [K4 concrete T2 handoff](https://github.com/pulse-compute/pulse/blob/67c984d8dc223dd94d1146353534b12a89e0e50b/wasm/test/kv/K4.md#concrete-t2-handoff) and existing runner define the contract:

- Isolated reviewed Fastly account/service/version, `catalog` KV store binding, exact Native Wasm SHA-256 and deployment receipt. Do not reuse unrelated live services/stores.
- Two to eight authenticated probe agents reaching distinct actual execution POPs. Client labels, source IPs or headers alone are insufficient.
- Every response includes independent service-side `serviceId`, `serviceVersion`, `storeId`, `moduleSha256`, `pop` and unique `requestId`.
- A controlled dropped-response relay on the first probe, with independent service-side receipt metadata and observation from another POP.
- A reviewed absolute-path driver exporting `createProbes()`, returning deployment identity, probe `invoke(command,{signal})`, first-probe `loseResponse(command,{signal})`, bounded read timeout and `close()`.
- Executor access to the actual Fastly API, service, agent and relay endpoints. No suitable Fastly transport connector or reviewed T2 agents are currently available in this session.

## Execution and acceptance

After provisioning and reviewing the real driver, use pinned Node 24 to run:

```sh
node wasm/test/kv/run-k4-deployed.cjs --driver /absolute/path/to/reviewed-T2-probe-driver.cjs
```

The runner validates deployment identities, stable distinct POPs and nonreused receipts before writes. Retain all three simultaneous create/CAS schedules, exactly one acknowledged winner, value/generation pairing, stale-CAS rejection, missing-key CAS rejection, conditional tombstone retention, bounded read-only visibility polling and the dropped-response uncertainty case. Mutations are never retried or rebased.

Retain driver identity, command/source identity, deployment and package receipts, raw reports, failed attempts, relay evidence and cleanup. Keep authority/tombstone keys as evidence; do not claim physical delete, expiry, cross-key transactions, restart recovery or global consistency from these checks.

The T2 operator owns provisioning and activation. The K4 runner neither discovers credentials nor activates services. Local gate fixtures already reject missing executables, mixed deployment IDs, same-POP evidence, reused receipts, missing response-loss capability and unknown write acknowledgement; those fixtures cannot supply the live result.

## Exit and release

Each pending hosted row needs current proof or a separately recorded explicit owner disposition. Independent integrated acceptance remains separate. Once both gates resolve, recheck candidate/ref/check identities, merge the qualified PR and execute the existing release audit and protected publishing workflow. Do not silently transfer receipts to a new candidate.
