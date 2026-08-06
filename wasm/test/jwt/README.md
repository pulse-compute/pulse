# JWT evidence

The sealed D0 through D4 checkpoints remain under
`wasm/.test-results/jwt-d0/` through `wasm/.test-results/jwt-d4/`.

The current E0 corpus contract is:

```bash
node wasm/test/jwt/assert-jwt-conformance-corpus.cjs
```

The task freezes one ordered 35-case HS256 corpus and a no-skip harness contract
for Node JavaScript, Fastly JavaScript, Node Native, and Fastly Native. Every
required cell has an executable Phase E outcome and an exact realization:
JavaScript uses `runtime-builtin`; Native uses
`guest-source:pulse-hmac-as`. Harness manifests are rejected when they omit or
skip a case, change realization identity, enable fallback, treat setup as
target behavior, or claim E0 contract preparation as runtime observation.

At E0, Fastly Native remained honestly distinct from the expected outcome. Its
frozen D4 readiness is `planning-blocked` with
`fastly-native-jwt-package-effect-unavailable`; E0 requires that blocker to be
resolved and the same corpus executed by E4. E0 does not claim target
execution. E2 resolves that historical blocker without rewriting the frozen
corpus or E0 evidence. The E0 task writes:

```text
wasm/.test-results/jwt-e0/jwt-e0-evidence.json
```

The frozen corpus and reusable harness contract are:

```text
wasm/test/jwt/jwt-conformance-corpus.json
wasm/test/jwt/jwt-conformance-harness.cjs
```

The earlier `jwt-cross-target-corpus.json` is preserved as historical D3 input
only. E0 authorizes E1's JavaScript reality gates. It does not mutate the frozen
`1.0.0-beta.1` release catalog, publish packages, deploy providers, add algorithms, or
claim Fastly Native JWT execution.

## E1 JavaScript reality gate

Run the shared corpus against Node JavaScript and a real Fastly JavaScript
artifact with:

```bash
PULSE_FASTLY_BIN=/absolute/path/to/fastly \
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
node wasm/test/jwt/assert-jwt-javascript-reality.cjs
```

`PULSE_FASTLY_BIN` is optional when `fastly` is on `PATH`.
`PULSE_VICEROY_BIN` is optional when the Fastly CLI manages its local Compute
engine. A passing E1 run bundles the Fastly provider closure with the pinned
esbuild release, compiles it with the pinned `@fastly/js-compute` release, and
serves the resulting Wasm through `fastly compute serve`. Node inference,
mocked Fastly execution, native relabeling, environment-selected realizations,
and automatic fallback are rejected.

Both JavaScript targets must execute all 35 ordered E0 cases with
`runtime-builtin` / `webcrypto.subtle.hmac-sha-256.v1`, for 70 completed and
zero skipped executions. The gate also verifies request-owned secret
resolution, authenticity before clock capture, registered-claim checks before
schema validation, detached immutable results, adapter wiring, and durable
redaction. It writes:

```text
wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json
wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json
wasm/.test-results/jwt-e1/jwt-javascript-redaction-report.json
wasm/.test-results/jwt-e1/jwt-e1-evidence.json
```

`--allow-fastly-blocked` is a diagnostic mode that records a conditional E1
result when the required local Fastly toolchain is unavailable. It is not a
Phase E pass.

## E2 Native reality gate

Run all 35 cases in default and experimental size-optimized modes for both
Local Native and Fastly Native with:

```bash
PULSE_FASTLY_BIN=/absolute/path/to/fastly \
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
node wasm/test/jwt/assert-jwt-native-reality.cjs
```

The gate compiles the canonical JWT effect with the package-owned
`pulse-jwt-as` source and the selected
`guest-source:pulse-hmac-as` implementation. Local Native authenticates through
the exact final module exports. Fastly Native receives one final Wasm artifact
per supported optimization mode and executes that exact artifact through
`fastly compute serve`; no Rust guest, linked guest unit, JavaScript runtime,
or fallback is allowed.

The gate records CLI inspection, build, local-engine boot, corpus/request, and
teardown timings separately. In particular, a Fastly CLI timeout after complete
version output is inspection time and is excluded from application execution
time. It also records final Wasm bytes/hashes, package and crypto source
contributions, total impact relative to a no-JWT control artifact, exact import
audits, and durable redaction. A pass is 140 completed executions and zero
skips. Evidence is written to:

```text
wasm/.test-results/jwt-e2/jwt-native-conformance-report.json
wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json
wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json
wasm/.test-results/jwt-e2/jwt-native-redaction-report.json
wasm/.test-results/jwt-e2/jwt-e2-evidence.json
```

## E3 Fail-closed audit

Run the focused ordering, redaction, error-taxonomy, and no-fallback audit
after the E1 and E2 reality gates:

```bash
node wasm/test/jwt/assert-jwt-fail-closed-audit.cjs
```

The audit adds direct package and provider spies, verifies planning failures
stop before compilation or packaging, and replays the security-critical
observations from all six JavaScript and Native target/mode lanes. It also
scans generated JSON, diagnostic and error projections, manifests, compiler
plans, predecessor test reports, and the E1/E2 Fastly-log redaction
attestations for bounded sentinel values. Evidence is written to:

```text
wasm/.test-results/jwt-e3/jwt-fail-closed-order-report.json
wasm/.test-results/jwt-e3/jwt-no-fallback-audit-report.json
wasm/.test-results/jwt-e3/jwt-redaction-audit-report.json
wasm/.test-results/jwt-e3/jwt-e3-evidence.json
```

## E4 Cross-target seal

Run the final Phase E seal after E0 through E3 with:

```bash
PULSE_FASTLY_BIN=/absolute/path/to/fastly \
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
node wasm/test/jwt/assert-jwt-phase-e-seal.cjs
```

The seal executes the complete frozen corpus once across all four required
target cells, including both Native optimization modes. It then runs the
focused JWT, crypto, compiler, configuration, Node, Fastly, JavaScript, and
Native checks; runs the relevant `unit`, `native`, `javascript`,
`conformance`, and `providers` aggregate once; checks documentation; and
audits all predecessor evidence and report hashes.

E4 records artifact sizes and observed build durations per target and mode
without treating them as benchmarks. It also confirms that the independent
Rust guest proof remains byte-identical to the Phase B seal, guest linking is
not load-bearing for HS256, only HS256 is executable, reports remain redacted,
claims remain unavailable before authenticity, no fallback exists, and no
production publication, deployment, or activation occurs.

A PASS requires all four cells, 210 completed corpus executions, zero skips,
exact final-artifact realization, and every fail-closed criterion. The known
working `1.0.0-beta.1` versus frozen release-catalog `1.0.0-beta.1` skew remains
non-blocking for E4 and blocking for publication until F0. Evidence is written
to:

```text
wasm/.test-results/jwt-e4/jwt-target-matrix-report.json
wasm/.test-results/jwt-e4/jwt-artifact-impact-report.json
wasm/.test-results/jwt-e4/relevant-aggregate.json
wasm/.test-results/jwt-e4/jwt-phase-e-seal.json
wasm/.test-results/jwt-e4/jwt-e4-evidence.json
```

## F0 Evidence consolidation

Run the evidence and current-contract checkpoint after E4:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-evidence-consolidation \
  --no-report
```

F0 does not rerun the expensive target corpus. It verifies the preserved A1–A4
memory decision, B0–B4 guest pipeline, C4 crypto seal, D4 JWT composition seal,
and E4 cross-target seal; rechecks the preserved artifact and report hashes;
audits the present-tense architecture, package, compatibility, lowering, and
guest-link documentation; and validates the explicit working-candidate
contract at
`wasm/test/jwt/contracts/jwt-crypto-working-candidate.json`.

The candidate contract synchronizes `@pulse-compute/crypto` and
`@pulse-compute/jwt` at `1.0.0-beta.1`. Runtime and provider packages remain identified
integration inputs rather than silently promoted candidate packages, and
`@pulse-compute/wasm-guest-link` remains a sealed proof input that is not
load-bearing for HS256. The frozen `1.0.0-beta.1` release manifest is verified by hash
and remains the sole npm release catalog.

F0 runs the suite-shape, maintainer-control-plane, documentation generation,
site, and full documentation-contract checks. A pass writes:

```text
wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json
```

The report authorizes F1 only. It does not publish packages, promote
documentation, deploy or activate a provider, or implement asymmetric
cryptography.

## F1 Impact and production-hardening assessment

Run F1 after the F0 evidence consolidation:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-impact-hardening \
  --no-report
```

F1 reuses hash-bound A–E observations and performs fresh file measurements; it
does not rerun the expensive four-target corpus. The assessor records:

- the JavaScript modules in the sealed E1 execution closure, their current
  bytes and deterministic gzip measurements;
- the Fastly JavaScript source bundle and downstream runtime artifact;
- JWT and crypto Native guest-source contributions;
- complete Node/Fastly Native artifacts in default and size-optimized modes;
- the Phase B guest-link proof artifacts, which remain non-load-bearing for
  HS256;
- build, local-engine boot, corpus, teardown, focused-test, and aggregate
  durations;
- deterministic artifact and plan hashes;
- the current package/dependency graph.

No pre-JWT Fastly JavaScript control artifact was sealed, so F1 reports that
incremental JavaScript delta as unavailable. It does not infer one from the
Native control or from the downstream js-compute payload. Likewise, the
Fastly CLI inspection timeout after complete version output remains tool
inspection and is excluded from application execution timing.

Production hardening is a separate nine-item inventory. Every item names its
owner, reason, next action, and evidence. A passing F1 assessment means the
inventory and measurements are complete; it explicitly classifies production
release readiness as `NOT_READY`.

F1 writes:

```text
wasm/.test-results/jwt-f1/jwt-f1-impact-report.json
wasm/.test-results/jwt-f1/jwt-f1-production-hardening.json
wasm/.test-results/jwt-f1/phase-f-deferred-work.md
wasm/.test-results/jwt-f1/jwt-f1-evidence.json
```

The F1 report authorizes F2 only. It does not change implementation, publish or
promote artifacts, deploy or activate a provider, widen target support, or
implement asymmetric cryptography.

## F2 Guest-link production-suitability reassessment

Run F2 after the F1 impact and hardening assessment:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-guest-link-suitability \
  --no-report
```

F2 reopens the accepted one-memory borrowed-span conclusion using the complete
A–E evidence chain. It is an evidence decision, not a new implementation or
release lane.

The assessment classifies guest-linked production cryptography as
`CONDITIONAL`. The accepted v1 ABI proves one synchronous read-only span of at
most 4,096 bytes and a scalar result. The current JWT contract permits an exact
signing input up to 16,340 bytes, so that ABI cannot be promoted unchanged to
an unconditional production-crypto claim. No asymmetric implementation has
yet supplied real stack, static-data, scratch, key-encoding, signature-encoding,
multi-field range, retention, or source-rebuild evidence.

F2 requires a caller-owned, compiler-laid-out invocation arena for the first
guest-linked cryptographic experiment. The arena and its versioned frame remain
private implementation contracts; there is no public allocation option. A
guest allocator remains prohibited under the current contract. Prebuilt
reproducibility is conditional on a clean maintainer-only source reconstruction,
source-built units remain maintainer-only, non-crypto generalization is not
ready, and the ABI stays private. The existing plan/report seams keep a future
Component Model replacement possible without promising that migration today.

F2 writes:

```text
wasm/.test-results/jwt-f2/jwt-f2-guest-link-suitability.json
wasm/.test-results/jwt-f2/jwt-f2-memory-assumption-ledger.json
wasm/.test-results/jwt-f2/guest-link-production-suitability-decision.md
wasm/.test-results/jwt-f2/jwt-f2-evidence.json
```

A passing F2 means every required classification and unresolved assumption is
evidence-bound. It authorizes F3 only. It does not change the memory ABI, add
an allocator, expose public or third-party guest support, add source builds,
implement asymmetric crypto, publish packages, promote documentation, deploy
or activate a provider, or change the frozen `1.0.0-beta.1` release catalog.

F3 resolves one F2 interpretation without rewriting the frozen F2 evidence:
4,096 bytes is the largest span exercised by borrowed-span v1, not the
physical limit of the existing guest input region. A versioned private frame
can grow within that region. The remaining conditionality is the absence of a
real asymmetric implementation proving its stack, static data, scratch,
multi-field validation, retention behavior, optimization, and source rebuild.

## F3 ES256, RS256, and Ed25519 recommendation

Run the three-candidate recommendation after F2:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-asymmetric-recommendation \
  --no-report
```

F3 applies the same 19 criteria to ES256, RS256, and Ed25519 across Node
JavaScript, Fastly JavaScript, browser JavaScript, Native Wasm, and ESP32. It
uses pinned primary-source observations and keeps code size, stack, scratch,
build cost, and reproducibility `UNMEASURED` until a real guest supplies those
facts. It does not turn unknowns into favorable scores.

The recommendation is **ES256, CONDITIONAL** for the first guest-linked
verify-only experiment. ES256 combines fixed-width inputs, SHA-256 reuse, an
allocator-free implementation path, and meaningful pressure on the private
guest-link seam without first introducing RSA large-integer machinery. RS256
remains the current JavaScript and identity-provider compatibility leader.
Ed25519 has the smallest wire shape and is a strong strategic second candidate,
but Fastly JavaScript verification is not documented, the ESP32 realization
is unproven, and its SHA-512 and identifier migration must be incorporated
explicitly.

The standards-precise JOSE identifier is `Ed25519`; `EdDSA` is deprecated.
Pulse's existing unpublished vocabulary still contains `EdDSA`. F3 records a
future versioned migration and does not silently add an alias or change the
public contract.

The smallest next experiment proposes a private 16,640-byte frame inside the
existing 1,572,864-byte input region. It carries at most 16,340 exact signing
input bytes, one normalized 64-byte P-256 `x || y` key, one 64-byte JOSE
`r || s` signature, and a bounded header/reserved area. It does not add an
allocator or reinterpret borrowed-span v1.

F3 writes:

```text
wasm/.test-results/jwt-f3/jwt-f3-asymmetric-candidate-comparison.json
wasm/.test-results/jwt-f3/jwt-f3-five-target-matrix.json
wasm/.test-results/jwt-f3/asymmetric-algorithm-decision.md
wasm/.test-results/jwt-f3/jwt-f3-evidence.json
```

A passing F3 authorizes F4 only. It does not implement asymmetric
cryptography, signing, or the private frame; change the memory or public ABI;
advertise target support; add fallback or source builds; publish packages;
promote documentation; deploy; activate a provider; or change the frozen
`1.0.0-beta.1` release catalog.

## F4 Final proof decision and handoff

Run the final seal after F3:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-final-proof-seal \
  --no-report
```

F4 records two independent outcomes:

```text
JWT/crypto loop: PASS
Guest-linked asymmetric readiness: CONDITIONAL
Recommended first algorithm: ES256
```

The loop result seals the existing HS256 implementation. One shared corpus
passed Node JavaScript, Fastly JavaScript, Node Native, and Fastly Native with
exact realization selection, no skipped executions, no fallback, fail-closed
semantics, and redaction.

The asymmetric result selects ES256 for a later bounded verify-only
implementation plan. Its condition is not physical capacity: the proposed
16,640-byte private frame fits the existing 1,572,864-byte input region. The
condition is the missing real-verifier evidence for frame validation, stack,
static data, scratch, optimized layout, pointer non-retention, reproducible
prebuilt bytes, malformed inputs, exact Node/Fastly Native execution, and
security review.

The seal includes snapshot and toolchain identities, every checkpoint and
phase status, a complete path/byte/hash manifest for all preserved A–F3
artifacts, both target matrices, selected HS256 realizations, no-fallback and
redaction evidence, measured impact, version status, unresolved assumptions,
deferred production work, and the exact next authorization request.

F4 writes:

```text
wasm/.test-results/jwt-f4/jwt-f4-artifact-manifest.json
wasm/.test-results/jwt-f4/jwt-f4-final-proof-seal.json
wasm/.test-results/jwt-f4/jwt-f4-final-handoff.md
wasm/.test-results/jwt-f4/jwt-f4-evidence.json
```

Passing F4 completes Phase F. The exact next request is to create a separate
bounded ES256 implementation plan. F4 does not itself authorize ES256
implementation, signing, a public guest ABI, target support, fallback, source
builds, npm publication, documentation promotion, remote deployment, provider
activation, or a change to the frozen `1.0.0-beta.1` release catalog.

## G3 ES256 crypto/JWT composition

After the G0 contract freeze and the G1/G2 guest proofs, run the executable
working-candidate composition:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-es256-composition \
  --no-report
```

G3 extends the shared JWT corpus with inline P-256 JWK and bounded static JWKS
cases. It executes the crypto-owned Web Crypto signature seam, the Node
JavaScript provider adapter, and the exact guest-linked Node Native artifact.
The task checks deterministic key selection, strict JOSE signature handling,
claim/schema ordering, distinct failure categories, redaction, and disabled
fallback.

G3 writes:

```text
wasm/.test-results/jwt-g3/es256-crypto-composition-report.json
wasm/.test-results/jwt-g3/es256-key-normalization-report.json
wasm/.test-results/jwt-g3/es256-jwt-corpus-report.json
wasm/.test-results/jwt-g3/es256-fail-closed-audit.json
wasm/.test-results/jwt-g3/jwt-g3-evidence.json
```

This remains an unpublished `1.0.0-beta.1` working candidate. G3 does not add signing,
remote JWKS discovery, a public guest ABI, fallback, publication, deployment,
or a change to the frozen `1.0.0-beta.1` release catalog.

## G4 ES256 exact-artifact cross-target conformance

Run the G4 gate with either an inspected Viceroy release or the Fastly CLI:

```bash
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-es256-cross-target \
  --no-report
```

G4 evaluates the same ordered 38-case ES256 corpus through Node Web Crypto and
the exact default and size-oriented Node/Fastly Native artifacts. Fastly
Native execution uses the explicitly identified local engine: direct
`viceroy serve` when `PULSE_VICEROY_BIN` is selected, or
`fastly compute serve` when the Fastly CLI is selected. Tool inspection is
timed separately. Invalid static key configurations complete as explicit
provider compile rejections, while all runtime cases execute as Compute
requests. Every provider-consumed Wasm hash must equal its final guest-link
audit hash.

Fastly JavaScript is recorded as ineligible because ECDSA verification has not
been proved there. It is not replaced with Node or Native evidence. Browser
and ESP32 remain unclaimed. The gate also replays the sealed HS256 Native
reality corpus to catch regressions.

G4 writes:

```text
wasm/.test-results/jwt-g4/es256-target-matrix.json
wasm/.test-results/jwt-g4/es256-javascript-conformance.json
wasm/.test-results/jwt-g4/es256-native-conformance.json
wasm/.test-results/jwt-g4/es256-node-native-reality.json
wasm/.test-results/jwt-g4/es256-fastly-native-reality.json
wasm/.test-results/jwt-g4/es256-artifact-impact.json
wasm/.test-results/jwt-g4/jwt-g4-evidence.json
```

G4 remains an unpublished implementation checkpoint. It does not authorize
signing, remote JWKS discovery, a public guest ABI, fallback, publication,
deployment, browser or ESP32 support, or a release-catalog change.

## G5 ES256 final proof seal

Run G5 with the exact Rust/Cargo toolchain, a Fastly local execution engine,
and (when available) an independent clean-container build output:

```bash
CARGO=/absolute/path/to/cargo \
RUSTC=/absolute/path/to/rustc \
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
PULSE_ES256_REPRODUCTION_ROOT=/path/to/es256-rustcrypto \
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-es256-final-seal \
  --no-report
```

The independent reproduction root is an additional comparison, not a
substitute for the local maintainer reconstruction. G5 runs the package
maintainer build twice from the exact locked source, requires raw and pinned
Binaryen-normalized byte identity, replays G1 through G4 in isolated output
directories, reruns the HS256 regression, validates the final memory and
non-retention contract, and runs the unit, Native, JavaScript, conformance,
provider, and CLI aggregates plus documentation and maintainer checks.

G5 writes:

```text
wasm/.test-results/jwt-g5/es256-source-reproduction.json
wasm/.test-results/jwt-g5/es256-final-memory-audit.json
wasm/.test-results/jwt-g5/es256-hardening-ledger.json
wasm/.test-results/jwt-g5/es256-artifact-manifest.json
wasm/.test-results/jwt-g5/es256-final-seal.json
wasm/.test-results/jwt-g5/es256-final-handoff.md
wasm/.test-results/jwt-g5/jwt-g5-evidence.json
```

A successful bounded proof reports PASS for the guest, Node Native, Fastly
Native, and Node JavaScript; Fastly JavaScript remains INELIGIBLE unless
separately proved. Production-release readiness remains NOT_READY until the
named hardening ledger closes. G5 does not publish, promote, deploy, or
activate anything.
