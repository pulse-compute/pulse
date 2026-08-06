# Guest-link feasibility evidence

This directory contains the isolated guest-link proof fixtures. It is evidence,
not a production compiler stage or a public guest-unit contract.

## A1 scalar-link control

The scalar control independently compiles:

- a `no_std`, allocator-free Rust guest for `wasm32v1-none`;
- a normal AssemblyScript module that imports the guest scalar function.

It then uses the Binaryen version transitively locked by AssemblyScript for the
Phase A spike to merge and validate one final core Wasm module. The same inputs
and final output are built twice, their bytes are compared, and the final module
is instantiated and exercised repeatedly under Node.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task guest-link-scalar-control --no-report
```

Rust, Cargo, and the `wasm32v1-none` target must already be available. The test
does not download or install a toolchain.

Generated evidence is written beneath:

```text
wasm/.test-results/guest-link-a1/
  guest-link-poc-primary.wasm
  guest-link-poc-guest.wasm
  guest-link-poc.wasm
  guest-link-poc.wat
  guest-link-poc-report.json
```

The A1 topology intentionally retains the normal independently owned memories
from AssemblyScript and Rust. Scalar linkage does not establish pointer
equivalence or byte interoperability. The report must therefore retain:

```text
phase A decision: not evaluated
pointer equivalence claim: false
accepted v1 candidate: false
next required gate: A2 memory experiment matrix
```

If Phase A later passes, Phase B must introduce direct pinned Binaryen ownership
in the guest-link implementation package. This spike must not be treated as
that production dependency contract.

## A2 byte-memory experiment matrix

The memory matrix adds the gate that A1 intentionally omitted.

Its negative control compiles the byte-reading Rust guest with its normal owned
memory and AssemblyScript with a separate owned memory. AssemblyScript writes a
nonzero pattern, but Rust observes zeros at the same numeric pointer because
its loads target the other memory. This rejects raw pointer equivalence rather
than merely warning about it.

The candidate then uses a tiny experimental owner module:

```text
memory owner exports env.memory
  ├── AssemblyScript imports env.memory
  └── Rust imports env.memory
```

The final linked candidate must contain exactly one fixed memory and no memory
import. It exercises zero-length, small, aligned, unaligned, and
boundary-adjacent spans; checks leading and trailing sentinels; verifies the
input remains unchanged; proves every fixture byte influences the result; and
returns an explicit status for invalid ranges without trapping.

The candidate also retains one allocator-free marker segment from each
toolchain. The report decodes every active data segment from the binaries,
checks the Rust stack, Rust static data, AssemblyScript static data, input, and
sentinel ranges as half-open intervals, and proves their placement is
non-overlapping before and after merge. Binaryen feature checks start from the
MVP allowlist; the negative control separately records the explicit
multi-memory feature and its rejected lowering attempt.

The marker-pointer exports exist only so this proof can verify segment origins
in the instantiated memory. They are not a proposed public or v1 guest ABI.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task guest-link-memory-matrix --no-report
```

Generated evidence is written beneath:

```text
wasm/.test-results/guest-link-a2/
  negative-control-*.wasm
  negative-control-final.wat
  candidate-*.wasm
  guest-link-poc-memory.wasm
  guest-link-poc-memory.wat
  guest-link-poc-memory-report.json
```

An A2 pass authorizes only A3. It does not establish optimized behavior,
Fastly compatibility, a production guest-link pipeline, or a Phase A PASS.

## A3 optimized artifact and target reality

The final-artifact proof applies the intended post-link Binaryen optimization
to the A2 single-memory candidate twice and requires byte-identical output. It
then audits the exact optimized bytes for validity, MVP-only features, one
fixed memory, imports, exports, start behavior, globals, data placement, size,
hash, and forbidden memory-management operations.

The complete A2 byte-span, every-byte, sentinel, empty, boundary, maximum, and
invalid-range suite is replayed against both the unoptimized and optimized
artifacts under Node. Their normalized observations must be identical.

For target reality, the proof links a fixture-only Fastly command shell around
the same optimized core input, starts it through `fastly compute serve` with a
pinned Viceroy binary, and makes two local requests. The shell independently
replays the complete suite and returns a deterministic normalized result that
must equal Node's result. The merged Fastly fixture is also built twice and
must be byte-identical.

Run:

```bash
PULSE_FASTLY_BIN=/path/to/fastly \
PULSE_VICEROY_BIN=/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs --task guest-link-final-reality --no-report
```

Rust, Cargo, `wasm32v1-none`, Fastly CLI, and Viceroy must already be
available. The test does not download, install, deploy, or contact a remote
Fastly service.

Generated evidence is written beneath:

```text
wasm/.test-results/guest-link-a3/
  guest-link-poc-final.wasm
  guest-link-poc-final.wat
  guest-link-poc-fastly.wasm
  guest-link-poc-fastly.wat
  fastly.toml
  guest-link-poc-final-audit.json
```

The Fastly command shell is proof-only and is not the Phase B production
pipeline, guest ABI, or provider implementation. An A3 pass authorizes only
A4. It does not establish a Phase A PASS.

## A4 evidence-bound Phase A decision

The decision task fails closed unless fresh A1, A2, and A3 runs satisfy every
Phase A PASS criterion. It rebuilds all three prerequisites beneath an
isolated temporary directory, verifies their source and artifact hashes,
cross-binds the accepted A2 candidate to the A3 optimization input and the
exact optimized core to the Fastly fixture, and evaluates every PASS,
CONDITIONAL, and FAIL condition from the execution plan.

Run:

```bash
PULSE_FASTLY_BIN=/path/to/fastly \
PULSE_VICEROY_BIN=/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs --task guest-link-feasibility-decision --no-report
```

Rust, Cargo, `wasm32v1-none`, Fastly CLI, and Viceroy must already be
available. The task performs no download or remote deployment.

Generated evidence is written beneath:

```text
wasm/.test-results/guest-link-a4/
  guest-link-poc-decision.md
```

The decision record is rendered twice in a fixed order with no timestamp or
absolute path and must be byte-identical. A PASS authorizes B0 under only the
recorded first-party, fixed-memory, allocator-free borrowed-span contract. It
does not create a production pipeline, public guest ABI, third-party guest
support, source-built application guests, or a crypto/JWT conclusion.

## B0 repository-bound contract design

B0 converts the exact accepted A4 boundary into a versioned, machine-checked
internal design. It defines:

- `pulse.guest-unit.v1`;
- `pulse.guest-unit-plan.v1`;
- `pulse.guest-link-report.v1`;
- `pulse.final-wasm-audit.v1`;
- `pulse.guest-memory.borrowed-span.v1`;
- closed first-party trust and ownership checks;
- compiler, guest-link, provider, diagnostic, and release ownership;
- the static core-Wasm composition boundary that a future component-model
  engine may replace without changing package semantics.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task guest-link-contract-design --no-report
```

The task requires the exact accepted A4 decision record already present in the
snapshot. It does not rerun Rust, Binaryen, Node/Fastly parity, or the Fastly
CLI. It verifies all mapped repository seams and renders deterministic evidence
beneath:

```text
wasm/.test-results/guest-link-b0/
  guest-link-contract-design.json
  guest-link-touchpoint-map.md
```

The manifest examples contain normalized toolchain identity but no executable,
shell, argument-vector, or source-build field. Manifest claims are never
authoritative; B1 must independently inspect packaged bytes. B0 changes no
production compiler, provider, release, materialization, or dependency code.
Its pass authorizes only B1.

## B1 internal guest-link package

B1 implements `@pulse-compute/wasm-guest-link` as the production owner of the
closed first-party guest-link boundary. It strictly validates B0 manifests and
plans, verifies the synchronized package owner plus artifact and source hashes,
independently inspects the packaged binary, materializes content-addressed
bytes, composes with directly pinned Binaryen, performs whole-module
optimization, audits the exact final bytes, and emits normalized deterministic
provenance.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task guest-link-package --no-report
```

The focused test uses checked-in exact A2 inputs and must reproduce the exact
A3 optimized core artifact without invoking Rust, Fastly, Viceroy, a network,
or provider packaging. It runs the realization twice, proves content-addressed
reuse and byte-identical reports, replays the Node memory suite, and exercises
negative metadata, owner, ABI, and artifact-integrity paths.

Generated evidence is written beneath:

```text
wasm/.test-results/guest-link-b1/
  canonical-native.wasm
  guest-link-report.json
  final-wasm-audit.json
  guest-link-package-report.json
```

B1 does not integrate package lowering or compiler collection, mutate provider
packaging, register arbitrary guests, or define a source-build contract. Its
pass authorizes only B2.

## B2 materialization and compiler stage

B2 adds the distinct first-party guest-unit contribution, compiler planning and
lazy content-addressed materialization, exact audited provider handoff, and
fail-closed target policy. The focused proof creates and reuses the same
materialization, deletes `.pulse/guests/`, recreates it from synchronized
package bytes, and requires identical materialized and final artifact bytes.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task guest-link-materialization-stage --no-report
```

## B3 audit, provenance, and diagnostics

B3 records package/source identities, input/final artifact hashes, exact linker
and optimizer identities, before/after Wasm surfaces, and disabled fallback
posture without retaining environment secrets, credentials, private material,
or raw buffers. Its negative matrix covers missing and invalid units, integrity,
trust, ABI, import/export, memory, start, feature, link, optimizer, and final
audit failures.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task guest-link-audit-diagnostics --no-report
```

## B4 Phase B seal

B4 independently replays B1 through B3, cross-checks the production final
artifact against the sealed A3 identity, and freshly runs those exact
production core bytes under Node and `fastly compute serve`. The Fastly check
uses the proof-only command shell and does not rebuild the package-prebuilt Rust
source. The seal also verifies synchronized implementation-package membership
and present-tense documentation, records artifact-size and focused validation
wall-clock impact, and confirms that no fallback, source-build workflow, local
override, or public third-party guest API exists.

Run:

```bash
PULSE_FASTLY_BIN=/path/to/fastly \
PULSE_VICEROY_BIN=/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs --task guest-link-b-seal --no-report
```

The task uses local Fastly CLI/Viceroy execution only and performs no remote
deployment. A pass seals Phase B and authorizes Phase C under its separate
guest-source crypto plan.
