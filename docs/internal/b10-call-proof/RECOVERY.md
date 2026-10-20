# Callable proof recovery checkpoint

The 2026-10-20 UTC recovery restores the exact source tree of the earlier
execution-boundary proof. It adds no public authoring API or runtime behavior.

- Branch: `codex/b10-call-proof-recovered`.
- Base: `8a51d705025c69ae306004215cb6cb48248d68e1`.
- Recovered code commit: `6b47239591ab44cd631417d90169330fd1dd4a81`.
- Recovered code tree: `20f61b33724b5b3dd6ee0578f8d37dd01e131cb9`.
- Original tested code commit recorded by the receipt:
  `04e567bb239daf16a538f33f216a17cce969e517`.

The reconstructed Git tree exactly matches the tree recorded in the prior
handoff. The original commit object and later documentation commit were not
recovered. These are new recovery commits, not restored original commit IDs.
The historical receipt separately names its comparison baseline as
`6266d7d3514289fe0c88c213bf8ed9645116ca9d`; that is not this branch's base.

## Evidence

`validation/` preserves the surviving historical passing proof, failed ownership
attempt, focused regressions and check logs. Their original bytes and source
identities are retained; they are not fresh executions on the recovery commit.
`recovery-manifest.json` records their SHA-256 hashes.

Fresh recovery checks: exact Git tree identity, clean source diff formatting,
and `npm run maintainer:check` passed. Runtime proof and full qualification have
not been rerun during recovery. No dependency installation is claimed.
Fresh documentation checks were attempted and failed because workspace package
dependencies are not installed in this recovered checkout. Both failure logs
are retained; dependency restoration and fresh documentation validation belong
to the next review handoff.

The historical proof passed HTTP/MCP fixtures on Node and an injected Fastly
host, with byte-identical unused-call Wasm and bounded rejection/deadline cases.
It does not establish deployed Fastly behavior, supported `ctx.call` syntax,
static imported target discovery or completion of B10-MCP-05.

## Review checkpoint

Dependencies have now been restored and the previously blocked documentation
checks pass. Fresh proof, build, docs, maintainer and scope results are captured
in `review-validation.json`; the proof ran on clean `51fcd83`. All 16 Wasm
hashes match the historical passing run. Only evidence/documentation changed
after that run. See `PR.md` for the prepared replacement draft.

## Small return boundaries

1. Recovery: restore identical source and retained evidence; return here.
2. Review handoff: inspect current upstream, prepare/publish the replacement
   draft PR, then close superseded #438 while retaining its branch; return with
   the PR link and exact validation status. No merge or release is authorized.
3. Authoring: define the narrow declaration and static target path, connect one
   authored call end to end, preserve the zero-use gate; return with evidence.
4. Integration: move context-mcp computation onto that path, then address its
   remaining outputs and deterministic vector/seal gates in separate units.

No background checks remain active at this recovery handoff. Publication has
not occurred. The user requested continuation with smaller return boundaries;
the next action is the review handoff, not a broad implementation pass.

## Protected scope

The original human direction authorizes shared computation machinery, moderate
call-site cost, zero or near-zero unused Wasm cost, and exclusion of the Entities
primitive expansion. Recovery preserves that scope. This declaration identifies
the existing proof's protected paths; it does not self-approve their merge.

<!-- pulse-maintainer-declaration:start -->
Change class: architecture
Scope: architecture-change
Protected boundaries: effect-capability-model, continuation-runtime, provider-registry, runtime-target-fluidity, package-publication, release-authority
Human decision: required
<!-- pulse-maintainer-declaration:end -->
