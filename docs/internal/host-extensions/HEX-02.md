# HEX-02 — Operation-level host contribution admission

Status: **integration candidate; no release or hosted acceptance**.
Work item: [#510](https://github.com/pulse-compute/pulse/issues/510).
Base: `788b1fe0c24d3277b0d01bba674ad86952e2f7fc` on `hex-integration`.
Work branch: `hex/02-operation-admission`.
Human direction: “Ok proceed” following the recommendation to advance to HEX-02
and leave the report-test investigation separate. Pass PRs continue to target
`hex-integration`; promotion to `latest` remains a human stability decision.

## Result

The private HEX-01 envelope is replaced by `pulse.host-extension.v1` in the
existing package `realizationArtifacts` carrier. The shared data-only contract
owns schema validation, package/contract authority, exact host/mode matching,
operation selection, source digests, import signatures and policy identity.
The selected provider descriptor advertises supported protocols and services.
There is no package-name registry, npm-version equality, new loader or export.

Generic GRIP methods and the provisional host-only `handoffFanout` operation
remain together in the GRIP package. Unsupported recognized calls fail with a
public diagnostic at their authored source location; dynamic JavaScript retains
the package's existing “not implemented for this host” behavior. Generic methods
do not require host contribution admission.

An independently named fixture package, version `37.4.2` with its own builder
protocol version, enters through ordinary package discovery and executes a
`transfer` operation using the same provider service. This demonstrates reuse
without a compiler or provider registry entry. It is a temporary external package
fixture, not installed tarball or publication acceptance.

## Boundaries

- The canonical contract is documented in
  [package-lowerer-contract.md](../../contributing/package-lowerer-contract.md)
  and [current-contracts.md](../../architecture/current-contracts.md).
- v1 admits bounded inline generated AssemblyScript only. Paths, module imports,
  exports and provider-private identifiers are rejected. Lowerers and their
  generated source remain trusted build dependencies, not sandboxed code.
- Each used operation requires one compatible contribution. Duplicate IDs,
  overlapping matches, inconsistent owners, entry collisions and unsupported
  protocol/service declarations fail. Selection and policy identity do not depend
  on contribution order. Unselected source and imports do not enter emission.
- The provider composes its baseline import ceiling with selected declarations
  before emission. Baseline redeclarations and conflicting selected signatures
  fail. Binary auditing verifies the full ceiling, selected signatures and
  policy digest; observed imports never grant permission.
- Fastly continues to implement only the existing single direct terminal
  request/backend service. Its request handle, backend allocation, token and
  ownership fences remain provider-owned. No mutable compiler/provider object or
  credentials are passed through the contribution contract.
- No second lifecycle form, scheduler integration, guest-unit composition,
  fallback, configuration field, supported GRIP symbol or release support promise
  is introduced. HEX-03 still owns failure ownership and cleanup acceptance.

## Evidence and remaining gates

The contract suite covers schema/owner/version/target validation, permutation
stability, duplicate/conflicting contributions, source containment and hashing,
import ceilings, actual Wasm signatures and tampered policies. The authored proof
covers an independent package, source-located CLI failures, missing backend
bindings and unselected contributions. HEX-01's lifecycle injections and exact
absent/unused/generic Wasm baselines remain executable controls.

The [validation receipt](hex02-validation.json) records completed task coverage, source identities,
failed development attempts and final checks. Focused tests are development
evidence, not an aggregate release claim. Generated diagnostic references and
the MCP context corpus/data are regenerated from their canonical owners; the
context producer uses the repository-pinned Node `24.18.0`.

[Issue #516](https://github.com/pulse-compute/pulse/issues/516) remains an
independent unresolved report-test stability gate. Its investigation branch is
not included here. A passing focused or portable run does not close that issue.
Actual Fastly/Viceroy behavior, cleanup/ownership acceptance, packed external
consumers and the release seal remain outside this pass's evidence.

Implementation direction is supplied. Architecture review, merge and promotion
authority remain human-owned; this record does not approve those actions.
