# beta.11 deployed Pulse K4 qualification

**Passed on the accepted beta.11 candidate.** One complete unchanged deployed K4 corpus ran across verified **IAD and LHR**, making **58 requests** with **zero mutation retries**. Cleanup passed.

## Results

| Check | Result |
| --- | --- |
| Distinct execution POPs before writes and on every reply | IAD and LHR, verified from server-side relay metadata and matching Compute `X-Served-By` |
| Three simultaneous create schedules | Exactly one acknowledged winner per schedule |
| Three simultaneous CAS schedules | Exactly one acknowledged winner per schedule |
| Accepted value/generation pairing and cross-location visibility | Passed |
| Stale-generation and missing-key CAS | Rejected as conflict on both probes |
| Conditional tombstones and resurrection exclusion | Passed |
| Controlled client response loss | Actual client `ECONNRESET`; application bytes discarded by the relay; committed receipt observed cross-location |
| Unique remote request IDs | 58/58 |
| Installed package files before/after | 20 exact tarballs, 1,231 files unchanged |
| Deployed identities before/after | Same Compute service/version, KV store binding, package files hash and shield configuration |
| Task-owned service cleanup | All three deactivated/deleted and absent from the account service listing |
| Test authority data | Isolated KV store and authority/tombstone keys retained |
| Account token | Kept active by explicit owner direction; absent from retained source, artifacts and logs |

[Complete aggregate record](beta11-k4-live/qualification.json), [unchanged runner result](beta11-k4-live/deployed.json), [remote request ledger](beta11-k4-live/requests.json), [response-loss receipt](beta11-k4-live/loss-relay.json), and [cleanup verification](beta11-k4-live/cleanup-verification.json).

## Candidate and artifact binding

- Release PR [#591](https://github.com/pulse-compute/pulse/pull/591), head `3817f027cee36f9503d35420a775afdf639af568`.
- Qualified merge source `67c984d8dc223dd94d1146353534b12a89e0e50b`, tree `77e58f4f93bf3f90d1f3390423218bc6d8a20462`; source unchanged.
- Accepted Actions bundle `13083118233`, ZIP SHA-256 `2de79c3f72776cda7ca2d575c7e69dfbc55e8e418523d1c11ae74911d1496324`.
- Exact candidate tarballs were extracted into isolated real package directories and checked against their manifests before and after execution. Frozen external dependency links supplied the compiler dependencies; this is not claimed as a fresh npm-registry install. Zero workspace product modules loaded.
- Existing K2 command handler was compiled against those installed packages. A private header guard was prepended for test authentication; the KV handler body remained unchanged. The account API token was never embedded. Unauthenticated direct Compute requests returned 401; authenticated reads returned the expected result.
- Native Wasm SHA-256 `4ae3a0674fd0e965b09a49f94104079bfbc4bd312d072705ea2b1bee61077505`, **41,247 bytes**. [Exact Wasm](beta11-k4-live/consumer.wasm), [uploaded package](beta11-k4-live/pulse-k4-local.tar.gz), [consumer source](beta11-k4-live/consumer.ts), [build receipt](beta11-k4-live/build.json).
- Uploaded archive SHA-256 `4139f36a0eef8dfbf9c53383dfb0e309c2045e6da7b77463f8849024cacad139`; Fastly files hash `c077af64fa611f42bd7d425ef8d704f444842cfcdfe19acca1fbd6d5710635617ff5b6cd6a3d99dc67f9537813bbbaef1232d992a3fd6c8b273a0d555784e2ef` matched the pinned CLI output and authenticated API before/after traffic.
- The one-use fixture authentication nonce is retired: all associated services are deleted and its local selector removed before publishing these test artifacts. It grants no active authority and must never be reused.

Tool identities and unchanged package/driver/runner hashes are retained in [artifact verification](beta11-k4-live/artifact-verification-after.json) and [external build dependencies](beta11-k4-live/external-build-toolchain.json). No release candidate, product source, runtime, API, or package publication was changed.

## Real probe transport

One isolated Compute service `YN5mZweFkYXqaGabK2QUlk`, version 1, linked `catalog` through physical binding `k4_catalog` to isolated store `5475f8scy7wj7172s88o3r`. Two task-owned VCL relays shielded requests to `iad-va-us` and `london-uk` before chaining to Compute. Fastly documents [shield-first service chaining](https://www.fastly.com/documentation/guides/getting-started/services/service-chaining/) and [shielded backend routing](https://www.fastly.com/documentation/guides/concepts/shielding/).

Only the origin-facing shield probe attached deployment identity, a server-generated UUID, and `server.datacenter` to each response. The driver verified that the independent Compute server header named the same POP. No caller location labels or supplied POP headers were accepted. Active-version and package inspection supplies the artifact binding; no cryptographic remote-binary attestation is claimed.

The existing [deployed runner and assertions](https://github.com/pulse-compute/pulse/blob/67c984d8dc223dd94d1146353534b12a89e0e50b/wasm/test/kv/k4/deployed.cjs) were unchanged. [The driver](beta11-k4-live/driver.cjs) supplied authenticated one-attempt POSTs, bounded bytes, abort signals and the response-dropping relay. The loss relay drained and discarded the real application response, retained independent service-side headers, and destroyed the client connection. No typed acknowledgement was delivered or synthesized; later reads only established the committed receipt.

## Attempts, ownership and limits

This was evidence work under the ordinary root/Wasm/release instructions; no single named Entry Point covers the operator deployment and cross-location qualification. User direction to proceed with K4 and the supplied temporary account token authorized isolated test resources and bounded live writes. Only task-owned resources were mutated. Existing Catalog services and stores were not modified.

The prior proxy timeout remains a blocked preflight, not a semantic failure. Setup also retained an initial recovered tarball-path failure and a rejected direct `freetls.fastly.net` domain registration. The documented `global.ssl.fastly.net` registration succeeded. These were repaired before corpus writes; one complete deployed corpus passed, without pooling partial reports.

All three test services were deactivated/deleted. The isolated store is named `pulse-k4-beta11-5de09fab`; its authority/tombstone keys remain as required by K4. The API key stays active for the user's other sessions. The operator harness imports the same API helper as the earlier #571 session; that helper's source is retained as `operator-dependency-fastly_ops.py` for audit, without its credential file. These are historical operator sources, not an installable deployment utility.

The separately required exact-candidate local K4 lane remains [run 41301552370](https://github.com/pulse-compute/pulse/actions/runs/41301552370), with the known Viceroy 0.21.1 semantic discrepancy and standing explicit disposition retained. This deployed pass does not relabel that local raw failure or replace the [accepted full release seal](beta11-qualification.md). No physical delete, expiry, cross-key transaction, restart durability or exhaustive global-consistency promise follows.

The release owner accepted #508 without an additional reviewer and directed administrative closure after publication and public package tests. That decision remains in force. Other provider evidence/dispositions stay separate in #572. No merge, tag or package publication occurred in this qualification.
