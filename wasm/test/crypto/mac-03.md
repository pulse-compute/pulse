# MAC-03: installed consumer and independent request proof

The `crypto-mac-text-installed` task packs the clean candidate, installs its
complete package closure outside the checkout through a read-only local npm
registry, disables lifecycle scripts and verifies every installed file against
its tarball both before and after execution. Product imports resolve inside
the installation; only the Fastly ABI model comes from the workspace. No
package bytes are patched. Public author types are checked from installed
declarations. The compiled Fastly build and exact source/package identity are
retained in the output bundle.

The fixture reads `x-request-proof`, passes exact message text from JSON, and
checks that the pre-existing synthetic Bearer header remains unchanged after
verification. 32 corpus rows execute on each of Node Native, Node JavaScript,
Fastly Native and Fastly JavaScript (128 executions). Three additional static
binding controls use the same emitted Fastly artifact. The excluded corpus
rows are listed in the receipt: dynamic algorithms/static authoring rejection,
provider faults and malformed provider strings remain MAC-01/02 evidence;
HTTP Fetch cannot transmit a newline inside a header.

Fastly Native is compiled Wasm with an injected host model; Fastly JavaScript
uses injected SDK APIs. Neither is Viceroy nor deployed-provider evidence.
Native frame cleanup is checked on returned paths. No timing-constant or
whole-heap erasure claim is made.

## Commands and evidence

```sh
node wasm/scripts/run-wasm-tests.cjs --task crypto-mac-text-proof-contract --no-report
node wasm/scripts/run-wasm-tests.cjs --task crypto-mac-text-installed --no-report
# Or choose a fresh, persistent, outside-checkout bundle directory:
node wasm/test/crypto/mac03/installed.cjs /absolute/fresh/mac03-bundle
```

The installed task requires a clean commit. It writes `installed.json`,
`acceptance.json`, package tarballs, fixture sources and `build/`. Receipt
loading rejects changed source harness, tarballs, artifacts and incomplete
case coverage. The contract task mutation-tests those rejections and rejects
wrong outcomes, altered Bearer flags, extra response fields and oversized
response bodies. Supplemental checks: existing MAC contract/provider/corpus
and conformance tasks, maintainer/docs checks and documentation release check.
Do not relabel a failed attempt; use a fresh directory after a correction.

The first development attempt completed runtime assertions but failed its
workspace-import guard because the allowed ABI helper filename omitted the
`native-` prefix. The guard was corrected to the exact existing host-model
file; no product imports were permitted. That failed receipt is retained
separately from the clean-commit retry.

## Hosted completion

Hosted qualification requires a human-authorized sandbox service with the
**retained** `build/bin/main.wasm`; do not rebuild from a different checkout.
Package the retained build without recompilation or Wasm annotation. A direct
tar archive containing `package/fastly.toml` and `package/bin/main.wasm` preserves
the retained bytes; `fastly compute build` can remove staged build output before
running its script and is not required here. Retain that archive, the pinned
CLI SHA-256/version and `fastly compute hash-files --package ARCHIVE --skip-build`
SHA-512 files hash. The runner checks archive Wasm identity against the bundle,
then verifies the active service version, domain and deployed files hash before
and after proof traffic. It does not deploy, activate or provision secrets.

Bind a secret store as `app_secrets`. With explicit owner authorization, provision `REQUEST_PROOF_KEY`
(32..4096 exact bytes), `MAC03_SHORT_KEY` (31 bytes), and `MAC03_LONG_KEY`
(4097 bytes), and leaves `MAC03_ABSENT_KEY` absent. Supply the matching proof
key to the runner as `MAC03_PROOF_KEY_BASE64` and an inspection-only credential
as `FASTLY_API_TOKEN`. Keep both outside retained artifacts, reports and command arguments. Use
a dedicated proof service: the fixture returns outcomes rather than enforcing
an application authorization policy. It performs no replay protection.

Configuration (contains identifiers and file pins, never key material):

```json
{
  "version": "pulse.mac03-hosted-config.v1",
  "serviceId": "SERVICE_ID",
  "serviceVersion": 1,
  "url": "https://PROOF_DOMAIN/",
  "package": "/absolute/mac03.tar.gz",
  "filesHash": "FASTLY_SHA512_FILES_HASH",
  "cli": {
    "file": "/absolute/fastly",
    "sha256": "CLI_SHA256",
    "version": "EXACT_FASTLY_VERSION_OUTPUT"
  }
}
```

```sh
node wasm/test/crypto/mac03/hosted.cjs /absolute/mac03-bundle /absolute/config.json /absolute/fresh-hosted-receipt.json
# Explicitly record a missing-configuration blocker:
node wasm/test/crypto/mac03/hosted.cjs /absolute/mac03-bundle - /absolute/fresh-blocked-receipt.json
```

18 hosted probes cover a fresh valid proof, changed message/key, first/middle/
last tag mutations, malformed/missing tags, maximum NUL and multibyte messages,
oversize/scalar failures and missing/short/long keys. Every request checks the
unchanged synthetic Bearer header. Reports contain outcomes and elapsed request
time, never tags, messages, key bytes or raw provider responses/errors. Latency
is diagnostic, not cryptographic timing evidence. The mutable runner key is
wiped; immutable environment strings cannot be erased. Missing configuration
records `blocked`, and cannot be interpreted as passed hosted evidence.

Hosted acceptance passed on 2026-11-27: all 18 requests passed on the retained
Fastly Native artifact, and both temporary resources were deleted and confirmed
absent. [Hosted closeout](mac-hosted/README.md) retains the exact receipt,
source-tree binding, package, provisioning/cleanup audit and qualification
limits. The earlier missing-configuration `blocked` receipt remains historical
evidence, not the terminal hosted outcome. This closes the hosted acceptance
gap for #601 without changing release/support status. The read-only hosted
runner itself grants no deployment or secret-provisioning authority.
