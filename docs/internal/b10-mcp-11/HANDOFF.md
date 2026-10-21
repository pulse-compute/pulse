# B10-MCP-11 — workflow and integrated-candidate handoff

Issue #460; [PR #482](https://github.com/pulse-compute/pulse/pull/482), targeting
`latest`. Entry point: `documentation-current`. Classification: documentation /
inside-developer-preview; no protected semantic boundary changes. The user’s
“Implement 11” covers canonical guidance, generated context/application mirrors,
installed workflow verification and this bounded evidence handoff.

## Source checkpoint

- Branch: `codex/b10-mcp-11`.
- Base: `1f2155e614bd99177f6505f207e4f188cd2d9caa`, merged 10B / #479.
- Candidate: `5614208b4982541d4cb90114f94fed461974e0df`.
- Candidate tree: `ee86d2cfc6ffe3164e208dc4fb77bf0239cdbe41`.
- Fresh source checks and standard package creation ran on that clean candidate.
- The subsequent handoff commit adds this repository-only evidence. It is a
  different source revision, not a newly qualified candidate. PR metadata records
  the final head. No checks remain running at handoff.

The interrupted implementation was recovered from local `a6ac6e0b8bbef79812967b9e3dd82c8aa9ef01b0`.
Focused and installed tests ran on that clean local revision, tree
`a41a71464003b281e8c857d2bedb6200defefe7c`. Its published equivalent is
`5507cd9736cd7d8e75240731df23e18d466acd3f`; full trees were compared. The candidate
above adds only the truthful Node JavaScript doctor gap to the canonical example
README and installed mirror. Corpus/application implementation bytes are unchanged
between those two checkpoints. This mapping does not turn the earlier receipts
into full qualification for the later revision.

## Deliverable

The canonical example now directs Native users to `application/`, distinguishes
that project from the root v1 host, and documents installation from one exact
candidate package set, doctor/inspect/build, local execution, Fastly provider
packaging and actual CLI/Viceroy serve. It explains the absence of an application
`npm test` script, the two ports/start commands, renamed diagnostic tool, bounded
pagination, lexical limitations and explicit modern/legacy client profiles.

The project lifecycle and MCP package guide point to that workflow. Release
acceptance explains regeneration before freeze, complete selections, separate
external MCP gates and parent-issue closure conditions. No package version,
release selection, compiler/runtime behavior, budgets or support promise changes.

Owner-driven `docs:sync` → `context:build` (Node 24.18.0) → `docs:sync`
regenerated 24 outputs, then compared all 30 canonical/mirror outputs. The new
264-row sparse lexical corpus has 2,509 dimensions, 15,386 nonzeros and 602,337
raw resource bytes. Corpus SHA-256:
`8c79970eee826dfd0d3ea67260a61d6b5450460b8155916993a1cedaccda95ef`.
Manifest SHA-256:
`cc50b59b7e885c0a96c36e484f57760f85163ad34bd8ded783bb42a4b88a1d27`.
The metadata/vector/text outputs and installed mirrors agree. No generator ran
after the candidate freeze; later checks reconstruct into scratch and compare.

## Terminal development evidence

[Receipt index](./receipt-index.json) records compressed file sizes and SHA-256s.
Receipts are gzip-compressed original JSON/logs, readable with `gzip -dc`.

| Check | Terminal result | Source / limit |
| --- | --- | --- |
| Five focused tasks | Passed 5/5, exit 0, 90.20 s | Local `a6ac6e0`: context build, corpus, application, host, executable root example |
| Complete `mcp-installed` gate | Passed, exit 0, 114.34 s | Same clean local checkpoint; standard 20-package pack, verified 18-package installed closure, Native and generic resource replay, existing root-host/client journey |
| Source-free Native tool replay within installed gate | Passed 537 requests across five tools | Removed authored sources, denied checkout reads, corrupt/missing artifact rejection |
| Installed command walkthrough | Node Native doctor/inspect passed; Fastly Native doctor/inspect passed; Node JS inspect passed | Unrelated copy of the exact verified installation; original commands/logs retained, not another install claim |
| Node JS doctor | **Failed**, exit 1 | `target-support`: unknown provider requirement; retained as a gap, not retried into a pass |
| Fresh source checks | Passed | Clean candidate `5614208`; includes read-only freshness and source/installed documentation validation |
| Standard final pack | Passed, 20/20 packages | Exact candidate; `--skip-build` uses the workspace build already performed by installed acceptance; fresh source/resource checks run again |
| Maintainer, docs, direct documentation-release, scope, diff checks | Passed | Final canonical documentation checkpoint; evidence-only follow-up gets final documentation/scope consistency checks |

The installed command walkthrough initially stopped at the failed Node JS doctor.
Its three remaining independent commands were run separately and passed; the
failed first receipt is retained. The failure is not repaired here. It blocks a
claim of a complete installed `node-javascript` dev/test workflow; the canonical
README now says so. Native commands and the unchanged v1 JavaScript host have
separate passing evidence.

The installed Native module hash was
`6fb4775801380fd416e6103ecfa35da500402e462dfe5dfe508dfb2677ef7345`.
Its complete retained plan hash and resource identities are in the installed
receipt. No fresh actual Fastly module/client receipt is claimed by 11.
The final CLI tarball is 1,392,988 bytes, SHA-256
`c7e91ab9d6f74f837a5462e94398c28fd19410115307e3c00689b26a6bb622da`.
It differs from the earlier installed CLI tarball because the README now records
the observed gap. All 20 final tarball identities are in the selection/pack
manifest; no final-pack installed replay is claimed.

Artifacts are at `/tmp/pulse-11-final-pack/`; working reports at
`/tmp/pulse-11-*.json` and
`wasm/.test-results/mcp-installed-EMBkMv/mcp-installed-acceptance.json`.
The installed runner removed its temporary consumers successfully. The separate
walkthrough used `/tmp/pulse-11-workflow-consumer`; logs are retained here. These
local pack paths are not durable release artifacts or publication receipts.

Full unit, CLI and release profiles were not repeated for these documentation
changes. The conservative scope classifier lists them because generated CLI
example sources change; their complete candidate execution belongs to #382.
No full seal, deployment, publication, merge or self-approval was performed.

## Complete integrated selection and next action

[Candidate selection](./candidate-selection.json) pins the clean revision/tree,
source-check digest, dependency/tool identities, producer/configuration and client
lockfiles, all 20 tarballs, the exact **211 release tasks and 11 installed gates**,
and three explicit actual-provider/MCP gates. All qualification remains pending.
It is a reviewable selection snapshot, not a recovery checkpoint or seal receipt.

[Acceptance reconciliation](./ACCEPTANCE.md) maps A01–A21 to current development
receipts, historical proofs and remaining gaps. #412 and #381 stay open until the
real-workload, generic-resource, installed, reporting and provider evidence is
reconciled on the selected candidate. #382 owns the full seal. Open #371 and
historical report-integrity uncertainty remain explicit; later green runs do not
prove those issues fixed. Deployed provider requirements retain their existing
owners and authorizations.

**One next action:** review PR #482. After review/merge and resolution of required
qualification blockers, #382 must freeze the resulting clean revision, regenerate
its source-check/selection identities, and execute the complete controller plus
separate external gates. A merge or evidence-only descendant must not reuse this
snapshot as if its revision still matched. Resume only through the controller's
verified same-candidate checkpoints; never pool these development reports.
