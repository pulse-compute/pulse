# MAC-01: authoring, lowering and trusted registration

Implemented on `crypto/mac-01-authoring-lowering`, based on MAC-00 commit
`9b2694330bd19852667d358b1de91304866bb125` (PR #617). User direction:
“MAC-00 is already designed. Proceed with MAC-01.” Refs #601.

## Delivered boundary

- Root/default/named `verifyMacText` facade; exact static HS256 and named secret
  options; message/tag runtime inputs; closed status-only result projection.
- Fixed `crypto.verifyMacText` operation registration, 458,752-byte envelope,
  bounded 65,537/65-code-unit over-limit prefixes before cloning. Invalid
  options never dispatch. Closed request contexts reject before projection.
- Lowerer emits exact HS256 demand, literal selector, operation plus secret.get
  authority and redaction. Secondary package host requirements survive both
  canonical and managed handler IR; algorithm planning remains separate.
- Current Node/Fastly Native/JavaScript builds reject the unimplemented
  capability. Direct-await only; no parallel/loop/shared-stage/callable admission
  expansion. Raw-byte verification, JWT API and provider implementations unchanged.
- Canonical guide/contracts and generated CLI/context artifacts synchronized.
  Generated context used the required Node 24.18.0 producer. Test shard mapping
  includes the new test and fixes MAC-00's inherited missing corpus mapping.

## Local development evidence

Lockfile install: pnpm 12.4.2, frozen lockfile, existing dependencies only,
ignore-scripts; execution Node 24.22.3. No dependency or lockfile edits.

Passed:

- Workspace TypeScript compilation and Crypto type assertions.
- Crypto/runtime Vitest: 11 files, 170 tests.
- Registered tasks: crypto-mac-text-contract, crypto-mac-text-corpus,
  crypto-digest-text-contract, package-reachability, package-exports,
  crypto-config-planning, canonical-api-lowering, package-runtime,
  jwt-package-owned-lowering, s3-read-contract, s3-write-contract,
  canonical-native-plan, canonical-api-runtime, canonical-native-wasm,
  external-lowerers, jwt-javascript-admission (16 unique tasks).
- After the final context-completion fix: repeated MAC/digest/package-runtime
  tasks and all 170 Crypto/runtime tests passed.
- Maintainer validation, documentation synchronization/site validation and
  documentation release validation.

The MAC test uses an injected adapter to inspect descriptors and project status
records. It does not verify HMAC. It tests real project inspection/build
rejection on four target cells, missing HS256, a provider missing secret.get,
static negative cases, unchanged generic envelope limits, redaction, no-dispatch
invalid options, and closed-context rejection. MAC-00 remains an independent
10-vector/30-classification reference oracle.

Development retries: initial facade import failed packaged resolution and was
corrected; an assertion initially expected Router errors to reject instead of
its error response; fixture config needed the required scope parameter; test
provider descriptors needed explicit lowering entries; duplicate type-test
bindings were corrected. One runner selection used an invalid task ID and
executed zero tests before correcting the selection. Maintainer validation
initially required regenerated pinned context output and then exposed MAC-00's
missing shard mapping; both were fixed. No failed run is a passing proof.

Raw development logs are retained in `/tmp/mac01-*.log` in the task workspace.
These are focused development runs, not a release seal. Exact final source and
CI state are recorded in the PR. Broad integration/release gates remain CI work.

## Next boundary

MAC-02 must implement provider admission/realization, exact scalar/byte/tag
validation and precedence, authorized secret lookup, reviewed selected verify
primitive, Native framing, cancellation/isolation and owned-storage cleanup.
No provider advertises support until that proof. MAC-03 must qualify the packed
consumer and deployed Fastly request with an unchanged independent Bearer token.
No merge, release, publication or deployment was performed; #601 stays open.
