# P12A — Attribution and diagnostics

RC item 05; base `latest` at `40427edd559c548bfd6db104696cb90beb3a5dc1`.
Human direction: “Implement 05” under the frozen eight-item RC scope.
No exact Entry Point covers this work. Necessary owners are CLI report capture,
comparison, replay and presentation; the public diagnostic catalog; provider
metadata forwarding; focused tests; canonical documentation and derivatives.
The provider records its existing advertised implementation ID. No runtime,
scheduler, ABI, import permission or contribution-envelope semantics change.

The Report v1 optional inventories are `hostContributions`, `hostUseSites`, and
`hostAudits`, with independent coverage counts. Contribution records retain
package name and snapshotted npm version, operation, contract/protocol/contribution
identity, generated-source digest (never its text), service, implementation,
target and policy digest. Sites link to their owning authored entry. Router
handler spans are explicitly `authored-entry`; unavailable positions remain null.
The model can represent distinct sites sharing a contribution without admitting
new runtime placements.

Capture reads the exact primary artifact, checks its hash, replays the existing
shared import auditor and checks selected realization-artifact identity. Audit
records retain the complete baseline/declared import ceiling and all observed
final-module imports. Replay validates policy digests, signature relationships,
artifact and entry links and coverage, without executing package code. These are
build observations, not signed attestation or independently repeated execution.
Lifecycle attachment coverage retains normal-return and trap limitations;
runtime observation coverage remains unavailable/not-recorded.

Ordinary explicitly declared application dependencies use the existing input
snapshot mechanism. This fixes independent installed lowerers being absent from
retained report closure without adding core package registrations or scanning
for provider implementations. Current project replay detects changed declared
package inputs. Historical capsule replay requires no source or package files.

Comparison separates contribution identity changes from site changes, includes
policy and import evidence, and leaves historical absence unknown. Optional
inventories keep historical v1 capsules/comparisons readable by current readers;
older strict readers can reject newly added inventories. JSON, terminal and
offline HTML share the same validated data. Public host diagnostics have exact
catalog anchors, compilation exit class, remediation and bounded authored
locations; source, configuration values and arbitrary nested details are omitted.

`cli-report-host-extensions` covers both GRIP ABIs, an independently named package
at npm version 91.7.3, Router attribution, repeated report site cardinality,
source/implementation/target/policy comparison, historical unknowns, invalid
imports/identities/links/coverage, private-data canaries, current/retained replay,
ordinary/unused controls and deterministic repeated capture. Existing report,
viewer, diagnostic and input-snapshot regressions complement this task. These
checks are development evidence, not item 6 installed/hosted qualification or
item 8 release sealing. Exact source and completed task coverage belong in the PR.
