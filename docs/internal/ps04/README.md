# PS-04: resumable seal evidence

Repository-only implementation notes. Human direction: implement PS-04 from the
next-stream plan. Base: `16d83612bbd5c17a1a0a87b698cc423160b5735a` (`latest`, PS-03).
This changes local recovery and evidence policy, not publication authority.

## Recovery ownership

The controller creates a durable `.pulse-seal/attempts/<run-id>` directory and
accepts one explicit preceding attempt with `--resume`. A checkout-wide lock
protects execution and the latest status alias. Rejected concurrent attempts
retain their own failure report without replacing the active owner's status.

| Work | Recovery rule |
|---|---|
| Bootstrap, source/prerequisite checks, dependency restoration, build, maintainer/publication/docs checks, workspace unit tests, advisory/license refresh | Executes every attempt |
| Exact shared package set | Reuses a verified package/log snapshot; replacement creates a new proof identity |
| Each of 163 release tasks and ten separate installed gates | Depends on the shared package proof and complete candidate/input context; only passed, cleaned-up work with intact output/log snapshots can reuse |
| External Fastly reality, final source/input checks and controller cleanup | Executes every attempt |

Context binds clean source/tree and checkout, full task selections, lockfile,
actual dependency/build/toolchain bytes, environment and provider options.
Definitions bind command arguments, timeout and output ownership. Snapshot
verification covers exact entries, modes, sizes and hashes. Each attempt records
executed/reused results and original proof identity; an invalid immediate
predecessor reruns its owner and dependent work. There is no ancestor search,
cross-candidate or cross-checkout cache, or remote restoration.

Checkpoints expire seven days after original execution. `--prune-recovery`
removes expired terminal attempts while preserving active/unclear work and
failed cleanup evidence. CI archives the durable directory for diagnosis.
Receipts are local integrity/provenance records, not signatures against a
malicious operator who controls the checkout.

## Validation scope

The complete unit profile passed 45/45 tasks. New checks cover corrupt, missing,
expired, incompatible and failed receipts; artifact restoration; dependency
invalidation; late subprocess failure; interruption; cleanup and receipt-write
failure; terminal runner errors; and lock/status ownership. Authority fixtures
exercise full synthetic 163-task and ten-gate reports while rejecting partial,
failed, altered and development evidence. Those fixtures do not execute a seal.

Build, documentation generation/checks, maintainer controls, publication controls
and preflight are local development checks. Dependencies were relinked from the
successful PS-03 checkout (Node 24.19.0, pnpm 12.4.2, AssemblyScript 0.28.18,
TypeScript 5.9.3); this was not a fresh dependency-bundle restoration.

The bounded real-package sample passed on the clean implementation candidate
`92da37c58a7143f85feefa3405109362bebf3dc2`: 19 packages, all seven installed
clean-machine corpora and `ast01-installed`. The first attempt took 244.418
seconds; retry took 1.112 seconds, restoring identical report/package bytes and
original proof identities with both tasks marked reused. These timings exclude
always-fresh seal stages and do not estimate full-seal savings. Its development
context cannot be aggregated into release evidence.

Final review then fixed termination when a child observer fails to persist the
seal lock or cancels synchronously. The affected lifecycle, checkpoint, recovery
and authority checks passed 4/4 after that change; the bounded package sample
was not rerun for this process-supervision fix. Compact results and provenance
are in `validation.json`. Earlier failed/incomplete attempts remain diagnostic
history, not passing evidence. Full seal, full recovery timing and external
Fastly reality remain PS-06 work; none is claimed here.
