# Shared lifecycle contracts — extraction checkpoint

Status: implementation and qualification checkpoint following merged lifecycle
spike #534. Human direction: “Ok proceed” to the bounded extraction of execution
and HTTP capability semantics before a nonterminal proof and RA-06.

Entry point: `provider-fastly`, extended by that direction to shared contract
owners, focused contract/provider tests and canonical documentation. Class:
architecture. Protected provider/target and continuation/effect boundaries remain
subject to human review. No merge, release, new host or admission promise is made.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `wasm/packages/contracts/src/handler/execution-lifecycle.js` | Six execution points, semantic parameter roles, composition rules, metadata ordering/validation, rejection and trap constraints |
| `wasm/packages/contracts/src/host/http-lifecycle.js` | Four optional HTTP points, authority-fence precedence, symbolic authority states and evidence requirements |
| Existing contracts `provider/toolchain` module | Exposes `executionLifecycle` and `httpLifecycle`; package export map and provider descriptor shapes unchanged |
| Fastly `lifecycle-hooks.js` | Role-to-AssemblyScript binding, concrete sites/rejections, required feature-mode anchors, source checks and emission |
| Fastly `response-authority.js` | Numeric diagnostic encoding, ABI dispatch, qualified transfer/completion mapping |
| Provider services | Their own resource state, handles, claims and qualified cleanup |

The shared modules contain no host calls, code-generation templates, numeric ABI
representation, concrete provider imports or runtime executor. Contribution
validation accepts metadata without source bodies. Execution-only selection does
not admit HTTP points. An HTTP-serving device can select the HTTP contract; the
hardware name does not decide capability membership.

Guards and predicates short-circuit on false; claims stop at the first true;
observers run in ascending distinct order. Around notifications run before in
ascending order and after in reverse, only on normal return (including rejected
delivery). Closure and end notifications are not trap finalizers. Site-specific
failure codes remain provider-owned within shared rejection postconditions.

HTTP authority remains owned → outcome unknown → transferred → completed.
Only provider-qualified observations advance transfer or completion. Unknown
outcomes and traps cannot reopen response authority. Completion does not prove
client delivery, host quiescence or resource disposal. Fastly keeps its current
status interpretation and qualified cleanup policy; this extraction does not
turn those observations into guarantees for another host.

## Qualification

[The evidence receipt](evidence.json) records source identities, comparisons and
validation outcomes. The existing spike's full runtime evidence remains under
[../lifecycle/](../lifecycle/); this checkpoint replays the relevant checks.

Seven matched fixtures cover absent/imported-unused/generic GRIP, Fanout,
WebSocket, incoming forwarding and budgeted Fanout. **Generated source, optimized
Wasm, ordered imports and extension policy are identical before and after the
extraction**, including selected-service builds. This is a zero-byte extraction,
not an execution-time measurement.

The focused checks include contract rejection/ordering/capability separation,
Fastly semantic binding/version rejection, compiled lifecycle composition,
terminal/forwarding execution and all 44 Native RA-05 lifecycle cases at widths
1/8/16/32. An isolated consumer packs the contracts package, extracts it outside
the checkout, and loads the contracts through the existing package toolchain
entry without loading Fastly. That is contracts packaging evidence, not installed
Fastly acceptance or second-host qualification.

```sh
node wasm/test/contracts/lifecycle-contract-cases.cjs --packed
node wasm/scripts/run-wasm-tests.cjs --task provider-toolchain --task package-exports --task fastly-host-extension-proof --task fastly-incoming-body-forwarding --no-report
node docs/internal/host-extensions/resource-accounting/ra05/check.cjs /tmp/shared-lifecycle-ra05 --lifecycle
node docs/internal/host-extensions/shared-lifecycle/identity.cjs /tmp/shared-lifecycle-before
node docs/internal/host-extensions/shared-lifecycle/identity.cjs /tmp/shared-lifecycle-after /tmp/shared-lifecycle-before
```

For the identity comparison, capture `before` at merged #534 (`4a06175`), then
capture `after` at this change with the same checkout path, runtime and compiler
recipe. Historical manifests and hashes are retained in the evidence bundle.

The next checkpoint remains a minimal nonterminal service and later second-host
pressure. Explicit template sites, package-completion delivery variants, complete
resource adoption, real-host disposition and matched execution-cost qualification
are still separate work. No new scheduler or general package hook API was added.
