# MAC-02: provider realization and local qualification

Implements the MAC-00 contract on the MAC-01 authoring branch for #601.
Entry point: package-lowering, packages/crypto. The human task “Implement
MAC-02” authorizes the Crypto implementation, Node/Fastly adapters and target
admission, native bridge/handle ownership audit, focused test registration,
and canonical documentation with generated copies. Merge, publication,
deployment and release support tiers remain separate human decisions.

## Realization

| Cell | Primitive | Secret resolution | Evidence |
| --- | --- | --- | --- |
| Node Native | Selected pulse-hmac-as HS256 verify | Provider-owned named binding | Compiled Native application dispatch |
| Fastly Native | Selected pulse-hmac-as HS256 verify | Secret Store open/get/plaintext into bounded bytes | Compiled Wasm with host ABI fixture |
| Node JavaScript | Existing Web Crypto HMAC verify | Provider binding capability | Shared application runtime dispatch |
| Fastly JavaScript | Existing Web Crypto HMAC verify | Provider SecretStore adapter | Shared runtime with injected SDK API |

Only the configured HS256 realization is accepted. MAC does not select the
HMAC-SHA256 signing operation, produce an authenticator, or fall back between
targets. Native borrows the existing 73,760-byte byte-operation frame; it does
not grow a host staging region per call or change raw-byte/JWT limits. The
Fastly store-binding admission check includes MAC's secondary secret demand;
omitting a store still selects the provider's existing documented default.

Validation is ordered before lookup and bounded before byte allocation.
Unexpected lookup, import and verification failures return only
realization-failure. The shared internal Web Crypto verifier gains an internal
import-failure classification parameter; its default preserves ordinary
raw-byte verification's invalid-key result. MAC has already validated the
key representation/length and treats a subsequent import exception as a
realization failure. Closed result projection rejects extra fields.

## Security and lifecycle evidence

The reference corpus is consumed unchanged: 10 fixed known answers and
30 classification cases through the provider helper; 34 applicable cases
through all four actual effect-dispatch cells (136 executions). Unsupported
static algorithms remain build negatives. Fault/state and invalid secret
representation cases are exercised separately at the provider boundary;
Fastly Native's host ABI supplies bytes, not malformed JavaScript strings.

Coverage includes exact Unicode, NUL/CRLF, 64 KiB ASCII/NUL/astral boundaries,
UTF-8 key encoding, 32/4,096-byte key bounds, full-length lowercase tags,
first/middle/last mismatches, scalar-before-byte-limit precedence, no lookup
on invalid/oversized input, operation/secret/primitive unavailability,
provider errors, malformed results, mutable-key snapshots and trace redaction.
Seven Fastly hostcall failure cases check missing stores/keys, errors, short
and oversized plaintext, including wiping a partially written error buffer.

Cancellation is tested while lookup and verification are pending, including
real Node Native dispatch and both JavaScript request runtimes. Late/duplicate
settlement cannot resume author code. Overlapping independent invocations do
not alias owned storage. Fastly Native's existing request deadline wins after
a delayed lookup, returning 504 rather than a MAC status. Author-level parallel
MAC calls, loops and shared-stage/callable expansion remain excluded.

Primitive review: pulse_crypto_hs256_verify accumulates XOR/OR over all 32
bytes before branching and wipes the computed expected tag. SHA finish wipes
state, block and schedule; HMAC wipes key block, key digest and inner digest.
The existing optimized Native guest-source test qualifies the selected source
and known answers. This is structural review, not a hardware timing proof.
Web Crypto uses verify, never sign followed by application comparison.

Owned JS key/message/tag bytes and Native frames are wiped on returned paths.
The Node frame adapter reacquires memory after Wasm growth and wipes on caught
traps (fault-injected). A terminal Fastly guest trap cannot execute cleanup;
the instance is abandoned. Neither complete guest-heap erasure after a trap
nor erasure of immutable provider strings/Web Crypto key objects is claimed.

## Validation and recovery

Development execution used Node 24.22.3 with the restored lockfile dependency
bundle; generated context artifacts used pinned Node 24.18.0. No dependency,
version, release manifest or deployment configuration changed.

Registered tasks selected:

- crypto-mac-text-contract, crypto-mac-text-provider,
  crypto-mac-text-conformance, crypto-mac-text-corpus, crypto-config-planning
- crypto-digest-text-contract, crypto-digest-text-conformance,
  crypto-native-guest-source, jwt-signing, jwt-javascript-admission,
  package-exports, package-reachability
- provider-fastly-package, provider-fastly-apps, fastly-javascript-runtime,
  fastly-native-http-shell, fastly-native-http-effects,
  fastly-native-platform-capabilities, canonical-native-wasm,
  canonical-api-runtime, package-runtime

Use `node wasm/scripts/run-wasm-tests.cjs --task <id> --no-report`.
The two new tasks are also registered in the unit/conformance profiles and
release evidence shard mapping. Supplemental checks: 170 Crypto/runtime
Vitest tests across 11 files; workspace build and Crypto type assertions;
maintainer synchronization/check, docs synchronization/check, documentation
release check, context regeneration/freshness and release preflight.

Initial fixture failures were corrected: Native inspection has no JavaScript
target-support object; omission of Fastly's store selects its documented
default rather than removing authority; executionOptions is frozen and must
be copied before injecting a test adapter. The explicit blank-store negative
also exposed the missing MAC site in Fastly JavaScript binding restrictions;
that admission gap is fixed. Failed attempts remain in /tmp/mac02-*.log in the
development workspace; retries are distinct. No production failure is masked
by retries. Final immutable source identity and terminal checks are recorded
in the PR; broad exact-source CI profiles remain integration evidence.

MAC-03 still owns unmodified packed-consumer and deployed Fastly proof with an
independent proof header and unchanged Bearer header. No Viceroy/live service
or installed-package acceptance is claimed here. #601 remains open.
