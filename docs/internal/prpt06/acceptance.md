# PRPT-06 acceptance reconciliation

This is the [v2 matrix](../prpt00/feature-spec-v2.md#14-acceptance-matrix), reconciled
against retained ticket evidence and the installed candidate. **Verified** means
the named proof passed within its stated contract. **Scoped** means an explicit
feature limit is preserved. **Partial** identifies a remaining qualification gap;
it is not a passing browser or large-corpus claim.

| ID | Disposition | Evidence and remaining scope |
|---|---|---|
| A01 — one capsule | Verified; browser export partial | [01](../prpt01/README.md), [04](../prpt04/README.md), [05](../prpt05/README.md), installed minimal/ARC/Catalog: project, manifest, replay and decoded HTML JSON agree; terminal identity/size agree. Actual browser Blob download identity remains unobserved. |
| A02 — determinism | Verified | 01 golden/hash/locale tests; installed repeated JSON and HTML are byte-identical. Replay from a separate cwd preserves evidence identity. |
| A03 — route fidelity | Verified within retained producer | [02](../prpt02/README.md) canonical order/shared/duplicate/non-HTTP tests; ARC inventories 18 routes and 23 entries. Partial composition/inventory facts remain labeled; no inferred routes. |
| A04 — no inferred authority | Verified | 01/02 declaration-only projection and negative fixtures. No permission inference from paths, bindings, policies or names. |
| A05 — evidence gaps | Verified with scoped limits | 01/02/03 and installed ARC: resource inventory partial, final reachability unsupported, Own/Shared unavailable. Unknown expected counts remain null. |
| A06 — integrity | Verified | 01/02/04 malformed/hash/path/concurrent-read tests; exact installed archive/artifact identity and historical replay. |
| A07 — size ledger | Verified; resource mapping scoped | [03](../prpt03/README.md) section/function framing tests; installed artifacts reconcile exactly. Asset input bytes are not presented as retained payload or exclusive Wasm ownership. |
| A08 — attribution limits | Scoped and verified | 00C/03 identity and rejection proof; ARC has 18/18 final handler bodies; Catalog has 12/100. Neither has qualified final reachable totals. Own/Shared remain unavailable because execution-root ownership is incomplete. No removal-savings claim. |
| A09 — HTML behavior | Partial | 05 and preview-correction element/model tests pass. User preview confirmed tabs/expansions/schema interactions. Real offline file opening, mobile layout, focus/keyboard, download behavior and corrected visual layout remain a browser follow-up. |
| A10 — malicious data | Portable verified; browser partial | 01/04/05 hostile strings and safe sinks/CSP; minimal/ARC JSON/HTML omit five private config-value/path canaries; Catalog omits four credential/endpoint/path canaries. Browser execution of adversarial fixture and actual download remain unobserved. |
| A11 — no hidden work | Verified within instrumentation | 02/04 guarded execution/canaries; installed collection/replay guard rejects Native compiler, provider, subprocess and network entry points; artifact mode rejects config/TypeScript. Static project config parsing is allowed. Reporting leaves guest hashes unchanged. |
| A12 — package integration | Verified | Official 20-package pack and clean install, 1,072 files byte-checked; shell/schema present; installed help/spec/reference/completions agree. Existing inspect/doctor checks reused on unchanged product code. Packed documentation link failure fixed at its canonical source. |
| A13 — practical corpus | Verified for selected profiles | Minimal Node Native, real Fastly ARC with generated frontend assets, and pinned Catalog Node Native pass. Catalog has 100 routes / 255 entries / 136 schemas; raw private inputs remain excluded. No synthetic scale substitute or all-profile claim. [Measurements](measurements.md). |
| A14 — bounded cost | Verified for three pinned corpora | [Measurements](measurements.md) separate project resolution, artifact collection and replay/rendering from builds; three process samples per mode, output sizes/RSS, unchanged guest hashes and proposed review budgets. PRPT-03 paired capture proof reused. Total build-time overhead and other profiles are not measured. |
| A15 — Wasm eligibility | Verified | 01/02/04 positive and fail-closed negative cases; installed Node Native minimal/Catalog and Fastly Native ARC succeed. Failed/interrupted builds cannot be reported or repaired by Report. |
| A16 — locked design | Portable implemented; visual qualification partial | Exact [four v2 fixtures](../prpt00/feature-spec-v2.md#19-locked-arc-design-baseline-and-library-asset-manifest), including expanded schema preview, remain authoritative. 05 plus PR #227 restores composition graph/counts/size structures; no new full browser pass is claimed. |
| A17 — schema accounting | Verified within projection | 01 recursive/reference/union/redaction/required-state proof; 02 canonical projection; 05 expansion/model tests. Real ARC has 17 schemas and Catalog has 136. Descriptor bytes remain distinct from compiled validator/Wasm size. |
| A18 — build-evidence lifecycle | Verified within frozen lifecycle | 02 stale/failed/interrupted/mismatched/concurrent checks and 05 receipt tests; installed repeat generation stays fresh and exact artifact hashes remain stable. Legacy builds still require explicit rebuild; historical replay asserts no current snapshot match. |

## Evidence reuse and limits

Prior packets retain their own source hashes and command results:
[01](../prpt01/validation.json), [02](../prpt02/validation.json),
[03](../prpt03/validation.json), [04](../prpt04/validation.json),
[05](../prpt05/validation.json). PR #227's 79-task unit/CLI run passed on tree
`e06804bc13fb8725d2336a286ca562602ee29f11`, identical to the PRPT-06 base tree.
The preview run skipped optional Viceroy replay because that binary was absent;
it is not deployed-provider evidence. PRPT-06 changes docs and opt-in evidence
helpers, not the Report product implementation. Its [validation record](validation.json)
identifies focused fresh checks and reused evidence separately.

The earlier browser transfer/file URL attempts were blocked by the environment.
PRPT-06 does not retry or bypass that policy. The user's preview is valid partial
human evidence, and the graph/count/size corrections are already merged, but a
portable element recorder does not measure layout. An explicit browser follow-up
or release-owner acceptance of this remaining scope is needed to claim more.

The renderer may expose multiple physical artifact stages or differing methods
for the same route. These are separate measurement scopes, not duplicate values
to collapse across stages. Semantically equivalent same-scope records coalesce
for display; conflicting variants remain visible. On real ARC the prelink stage
has unavailable handler/reachable mappings, while the **final** stage has mapped
handlers and unsupported reachability. They are not interchangeable evidence.
