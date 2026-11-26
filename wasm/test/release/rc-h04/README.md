# RC-H04 — provider qualification

Status: **completed for the recorded packed candidate**. The deployed follow-up
and cleanup are recorded in [live/README.md](live/README.md) and
[live/evidence.json](live/evidence.json). This is provider qualification toward
RC1, not the RC-H05 aggregate release seal.

## Candidate and results

The hosted proof uses clean source `d012f547f804af6e272cb1a6aeafe970c22e0b77`,
tree `ae28b53c6a31c77354e06d1e2d8816139b329eb2`, from PR #615. All 20
package tarball hashes are identical to the earlier clean RC-H03 merge
`a25052124cb670108eecce1710f93c2fb60fd84a` used by this directory's local
Compute/K4 checks. The terminal local and hosted receipts reference the same
installed bundle and exact Wasm artifacts; the aggregate terminal verifier passed.

| Gate | Recorded result |
| --- | --- |
| Generic Compute reality | Passed through CLI 16.1.0 and explicit Viceroy 0.21.1 |
| Dedicated local K4 | Release gate accepted only the existing narrow Viceroy missing-key discrepancy; raw semantics remain failed |
| Installed terminal | Twenty packages, eight artifacts, 15 negative admissions and 20 injected cases passed |
| Real local terminal | Fifteen transport cells passed in CI after the local sandbox socket restriction |
| Hosted terminal | Complete 15-cell replay passed on five isolated active versions; artifact/version/domain identity verified before and after |
| Deployed Pulse K4 | Fifty-eight requests across runtime-verified IAD/LHR, three create/CAS schedules, stale/missing exclusion, retained tombstones and controlled response loss passed; zero mutation retries |
| Live S3/fetch | Sixteen cases passed, including text write/read, opaque binary/range/conditional reads, GET/DELETE/OPTIONS, collected errors and timing |
| Cleanup | Nine owned services, two stores, four KV keys, one object and its scoped object credential retired; controlled origins stopped |

No new owner waiver was needed. The standing local Viceroy disposition remains
separate from successful deployed Pulse KV semantics. No upload/list/delete S3
operation or other new public feature is admitted by these fixtures.

## Retained attempts and boundaries

Files directly in this directory retain the original preparation checkpoint,
including its historical `evidence.json` status of `blocked`. They are not
rewritten to claim later execution. The follow-up under `live/` closes its
provider gaps with new exact-source receipts.

All failed attempts remain available. Hosted terminal attempts stopped after
13 cells with a 502 on the newest Fanout route and after 14 cells with a held
response timeout. A later complete unchanged replay passed all 15 cells; partial
runs were not combined. The held-response timeout has no established causal
diagnosis and is retained for review, not relabeled as a success. The first
cross-location attempt timed out on a read before mutations; its fresh full
replay passed. Neither case changed the acceptance assertions or budgets.

The local fetch deadline proof retains 103 ABI assertions and nine real-engine
HTTP cases. Its Viceroy 0.18.0 replay is separate from the deployed origin proof.
The local unidentified-engine K4 failure is also retained; only the explicit
0.21.1 replay received the pre-existing missing-key disposition.

These are bounded qualification observations. They do not establish exhaustive
global consistency, restart durability, a new freshness guarantee or an RC1
release seal. RC-H05 selects the final release identity and runs the required
aggregate/installed gates on its frozen source. Changed package or artifact
bytes require fresh evidence or an explicit reviewed binding; these receipts
must not be relabeled for another candidate.
