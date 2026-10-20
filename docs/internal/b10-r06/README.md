# B10-R06 — Native dynamic-backend ABI and R07 decision

Issue [#407](https://github.com/pulse-compute/pulse/issues/407). Target `latest`.
Class: evidence. Entry point: `provider-fastly`; additional owners are the
existing Native effects regression and this repository-only contract note. Baseline
`138ab310de081e4f8bf62a8a90966c9731c40510`, tree
`5632ed9453842131ee55cb4a5269eb123942c65f`.

**Decision: proceed to R07 using the existing explicit
`bindings.dynamicBackends` boolean.** No new public configuration, effect,
scheduler or lowerer authority is needed. R06 changes no production provider
source or advertised target eligibility. Its AssemblyScript program is a
standalone ABI experiment, not a Pulse application or the R07 implementation.
R08 still owns public-application parity, overhead and deployed qualification.

## Evidence and ABI

The existing registered `fastly-native-http-effects` task compiles the probe with
lockfile AssemblyScript 0.28.18, then exercises the actual Wasm calls through an
independent host oracle. Thirteen cells check registration buffers/flags,
HTTP/TLS separation, distinct targets, reuse, reverse consumption with ordered
output, rejection without dispatch, failure status propagation and the bound
on both successful and failed registration attempts. The disabled control has
no `register_dynamic_backend` import. Its parent task already belongs to
`providers` and the complete release selection. No task, timeout, scheduling
or release-shard definition changes are needed.

The separate `--viceroy` run requires an explicit Viceroy binary and OpenSSL.
It never substitutes a mock for a missing local host. Viceroy 0.21.1 exercises
two distinct runtime-supplied loopback origins without configured backends,
fresh-request name reuse, same-origin reuse, reverse completion, Host override,
TLS with a proper test CA/server chain, hostname and trust rejection, reserved
flags, empty Host, duplicate names, static-name collision and the disabled
static control. The origin barrier requires both requests to arrive before
either can complete; arrival order itself is unconstrained.

Pinned upstream: Fastly Viceroy commit
[`ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f`](https://github.com/fastly/Viceroy/tree/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f).
The ABI declaration is in
[`compute-at-edge.witx`](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/wasm_abi/compute-at-edge-abi/compute-at-edge.witx),
the layout/flags in
[`typenames.witx`](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/wasm_abi/compute-at-edge-abi/typenames.witx),
and local semantics in
[`req_impl.rs`](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/wiggle_abi/req_impl.rs).

The wasm32 call is
`fastly_http_req.register_dynamic_backend(name_ptr, name_len, target_ptr,
target_len, mask, config_ptr) -> i32`. Strings are pointer/byte-length pairs,
not NUL-terminated strings. Target is an authority, not an absolute URL.
Registration returns a status; later `send_async` receives the exact name.
There is no unregister call in this ABI.

`dynamic_backend_config` is 108 bytes, aligned to four bytes in this pin.
Allocate/zero the full structure even when using only its initial fields.

| Field | Byte offset | Enabling mask |
| --- | --- | --- |
| Host override pointer / length | 0 / 4 | `1 << 1` |
| Connect / first-byte / between-byte timeout words | 8 / 12 / 16 | `1 << 2`, `1 << 3`, `1 << 4` |
| TLS min / max version | 20 / 24 | `1 << 6`, `1 << 7` |
| Certificate hostname pointer / length | 28 / 32 | `1 << 8` |
| Additional CA pointer / length | 36 / 40 | `1 << 9` |
| Cipher pointer / length | 44 / 48 | `1 << 10` |
| SNI hostname pointer / length | 52 / 56 | `1 << 11` |
| Client certificate / key and later options | 60–104 | Unused and zero in the probe |

TLS is selected by `1 << 5`; bit zero is reserved. The local host rejects
reserved flags and empty Host with status 2, and duplicate dynamic/static names
with status 1. The strict oracle also injects statuses 5 and 13. Those injected
statuses do not prove a real service-capability or host-resource-limit failure.
Never interpret an arbitrary failed registration as permission to reuse a name.

The three 1000 ms timeout words in the probe are layout canaries, not proposed
production defaults. Viceroy's pinned implementation uses first/between-byte
timeouts but does not implement the connect-timeout word. Its TLS implementation
requires SNI and certificate hostname to agree. The R07 derivation below meets
that restriction without exposing new TLS settings.

## R07 contract

| Concern | Implementation decision |
| --- | --- |
| Opt-in and precedence | An explicit per-effect backend wins; otherwise an exact configured canonical-origin mapping wins. Only an unmapped ordinary fetch may register dynamically when opted in. With opt-in disabled, preserve current static admission and the platform path's legacy single-backend runtime fallback. With opt-in enabled, that fallback must not swallow distinct unmapped origins. |
| URL admission | First Native dynamic support admits bounded absolute ASCII HTTP/HTTPS URLs with ASCII DNS names and ports 1–65535; HTTP also admits canonical dotted-decimal IPv4. Reject credentials, backslashes, control/space characters, malformed authorities, noncanonical IPv4, HTTPS IP literals, Unicode/IDNA and IPv6 authorities with an explicit unsupported/invalid diagnostic. Static/off behavior is unchanged. Broader Native URL support needs its own parser/parity proof; never misclassify an unsupported host as another origin. |
| Canonical origin | Lowercase scheme/DNS host; remove an explicit default port from origin/Host identity. Preserve a DNS trailing dot. Require valid DNS labels and canonical IPv4; do not approximate WHATWG's unusual numeric host forms. Path/query are not backend identity; strip fragments from the outbound URI. URI bytes remain under the existing provider buffer budget and authority under 1024 bytes. |
| Target and Host | Registration target is canonical host plus explicit effective port (80/443 or the nondefault port). Host override is the canonical URL authority, including a nondefault port. It overrides an authored Host header for a dynamically selected destination. Preserve the outbound path/query and default empty path to `/`. |
| TLS | HTTPS sets USE_SSL, certificate hostname and SNI to the same URL hostname, excluding the port. HTTP sets none of these fields. Production uses normal platform trust, with no new CA, client-certificate, cipher or certificate-disable options. The local proof's additional CA is fixture-only. |
| Identity and reuse | A request-local tuple binds canonical origin and the fixed Host/TLS/policy settings. Compare fields exactly; do not key only by hostname or an unverified hash. Repeated paths at one origin reuse the registered name. Scheme, effective port or incompatible TLS/Host policy must not alias. Names use a provider-reserved prefix and a unique attempt slot; host rejection on a name collision fails closed. Never reuse a pre-existing host name after an error. |
| Resource bound | At most 32 registration attempts across the entire request, including failed attempts and successive collections. Cached hits do not consume attempts. Check before the hostcall; never evict/re-register or reset the counter during continuation resumption. The existing 32-member collection bound remains independent and unchanged. Host backends have no explicit unregister operation; clear guest bookkeeping on request entry/finalization and do not promise release of host-side network resources. |
| Deadlines and cancellation | Resolve/register before allocating outbound request/body handles, with existing admission and monotonic-budget checks before/after registration and before send. Keep the existing request/effect deadline, generation fencing, pending-handle retirement and ordered reconstruction. Registration never replenishes a budget, follows redirects, retries a failed send, or claims rollback of dispatched work. |
| Backend timeout policy | Leave optional registration timeout flags unset in the initial R07 implementation; keep platform defaults and Pulse's existing deadline owner. New backend-timeout configuration would require an explicit contract/key review. R06 timeout-word acceptance does not prove deadline semantics. |
| Failures | Validate before dispatch; never fall back to a static backend or JavaScript after registration failure. Preserve the existing fetch/hostcall error distinction. Record a bounded stage/status and actionable remediation for unavailable dynamic-backend capability, invalid configuration, registration failure and attempt-budget exhaustion. Extend the canonical diagnostic catalog through its owner if new public IDs are needed; do not emit raw URLs, tokens, headers or credentials. |
| Other operations | S3 bindings, GRIP control endpoints and experimental terminal body forwarding keep their explicit static backend requirements. This work adds dynamic selection to ordinary fetch only. No new redirect, arbitrary TLS override or outbound-authority surface is implied. |
| Disabled/no-use builds | Do not emit a registry, new imports or helper strings when dynamic selection is disabled or no ordinary fetch needs it. Preserve exact generated-source/Wasm identities for existing no-feature fixtures. The standalone control is a technique proof; R07/R08 must establish this on actual Pulse artifacts. |

The URL subset is an explicit Native dynamic eligibility boundary. JavaScript
continues using the SDK/WHATWG URL path and may accept additional host forms.
No new shared authoring syntax or configuration is proposed to conceal that
difference. R07 must report it in capability inspection and canonical docs.

## Owner map and implementation order

| Owner | R07 work |
| --- | --- |
| `src/toolchain/config.js`, `src/config-api.js` | Reuse normalized `bindings.dynamicBackends`; no new field. |
| `src/provider-contract.js`, `src/build/canonical-target.js` | Keep admission, realization and inspection truthful for the supported Native path. |
| `src/build/native-platform-capabilities.js` | Pass runtime URL to backend selection before `__pulse_fastly_start_request`; retain explicit GRIP/static paths. |
| `src/build/native-http-effects.js` | Apply the same policy to the lower-level fetch-only generator. |
| New provider-owned `src/build/native-dynamic-backends.*` helper | Share the bounded parser, ABI packing and request-local registry between those generators; emit only when selected. |
| `src/build/native-fetch-deadlines.as.ts`, `native-fetch-errors.js`, `native-handle-ownership.js` | Preserve existing deadline/failure/ownership machinery; extend its bounded stage classification rather than duplicating it. |
| `src/testing/native-http-effects-host.js`, `native-platform-capabilities-host.js` | Strict registration, named routing, attempt bounds and failure fixtures. |
| Existing JavaScript adapter/source-package and target-support owners | Parity reference; do not change ordinary JS behavior to match a narrower Native parser. |
| CLI diagnostic catalog, `docs/packages/provider-fastly.md`, capability guide | Publish only implemented support/prerequisites and regenerate mirrors through canonical owners. |
| Provider tests and R08 installed/public fixtures | Cover all paths, mixed static/dynamic selection, schema/middleware/errors, deadlines/cancellation, and disabled byte identity. |

Paths in this table are relative to `packages/provider-fastly/` unless explicitly
described as shared CLI/docs/test owners. The order is shared helper and parser
tests, both generation paths, admission/reporting, lifecycle failures, then
canonical docs and public/installed parity. A production runtime/configuration
incompatibility beyond these choices returns to human review before expansion.

## Local versus hosted boundary and reproduction

Fastly's [backend guide](https://www.fastly.com/documentation/guides/integrations/non-fastly-services/developer-guide-backends/)
requires the Dynamic Backends service capability; account access may require
Fastly support. An enabled local Viceroy probe does not establish entitlement on
a deployed service. Hosted DNS, public-root TLS behavior, resource limits,
connection reuse, unsupported-capability diagnostics and exact Pulse application
acceptance remain R08 gates. No service was created, configured or deployed.

```bash
node wasm/scripts/run-wasm-tests.cjs --task fastly-native-http-effects --task suite-shape
PULSE_VICEROY_BIN=/absolute/path/to/viceroy R06_PROOF_FILE=/tmp/r06-local.json node wasm/test/provider/assert-fastly-native-dynamic-backend-abi.cjs --viceroy
```

Viceroy release archive SHA-256:
`54a5b46ab05ce1492f4df136728b2eb81b350cb42da5d9f2eec66558ddc1e233`;
selected Linux executable:
`881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9`.
The local certificate/key are generated in task scratch space and removed;
only the CA and TLS-Wasm digests enter the receipt. They are not production keys.

`proof.json` retains final strict/local observations, source identities, commands,
failed-attempt disposition and boundaries. The probe's size delta is not Pulse's
production artifact overhead, and no remote-latency, CPU/RSS or seal claim is made.
