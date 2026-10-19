# B10-MCP-05 — blocked application migration

**B10-MCP-05 is not implemented.** The application migration exposed a missing
managed-execution prerequisite between 02 and 04. This evidence change adds no
compiler, package, provider, application, resource or release behavior.

Proposed prerequisite: [B10-MCP-05A / #436](https://github.com/pulse-compute/pulse/issues/436).
The user directed “Implement B10-MCP-05.” Under the root instruction to stop for a
new semantic/authority decision beyond the approved unit, this change makes the
new managed execution contract reviewable before implementation. It does not
record architectural approval or a completed application.

No named Entry Point matches this internal readiness investigation. The root and
docs ordinary instruction chain applies. The reproducible probe, receipts and
this handoff are the only reviewable changes.

## Reproduced boundary

The source under test is merged `latest`
`ed8e2bd4d8e1e367b254a62245ff5afad179411a`, tree
`590e6ebe40b5c30d89f1c39e3b93fe934a6ee0b9`.

| Isolated schema-bound MCP operation | Node Native compilation | Fastly Native compilation | Node JavaScript compilation |
| --- | --- | --- | --- |
| Scalar input + constant | Accepted | Accepted | Accepted |
| `ctx.encodeJson` | Rejected | Rejected | Accepted |
| `ctx.decodeJson` | Rejected | Rejected | Accepted |
| Resource `readU8` | Rejected | Rejected | Accepted |
| Resource `readUtf8` | Rejected | Rejected | Accepted |
| Numeric workspace write/read | Rejected | Rejected | Accepted |
| Literal-capped loop with local accumulator | Rejected | Rejected | Accepted |

A separate ordinary Node Native handler combines resource scalar/UTF-8 reads,
a fixed-capacity workspace, a bounded loop and typed JSON encode/decode. It
compiles to Wasm and executes to `{"value":273}`. This is a positive control for
the existing primitives, not acceptance of the MCP application. JavaScript rows
above are compilation evidence, not runtime parity. Fastly rows are compiler
admission evidence, not Viceroy/deployment evidence.

Run the probe with the restored lockfile-pinned development dependencies:

```bash
node docs/internal/b10-mcp-05/reproduce.cjs /tmp/b10-mcp-05-readiness.json
```

The script asserts the currently observed rejection. It is deliberately **not**
registered as a passing feature gate: after the prerequisite lands, replace this
historical diagnostic with positive behavioral acceptance in the owning suite.
[readiness.json](./readiness.json) records terminal observations, diagnostics,
source identity, Node version and the positive control's Wasm hash.

## Why the 02 and 04 results did not cover this

`wasm/packages/compiler/src/spine/handler-ir-managed.js` has a distinct closed
managed-handler vocabulary. Its expression compiler rejects arbitrary calls,
including the schema/resource/workspace calls required here; its statement
compiler admits const locals, branches, selected effects and schema-bound
returns, but not the bounded loop/scalar-state subset. Native facts are exported
through a private compiler projection.

`packages/entities/pulsewasm.native.cjs` consumes those facts and owns a separate
Native dispatcher/emitter. It currently implements that smaller vocabulary.
The MCP Native builder composes the Entities emitter. Ordinary Native plan
resource/workspace support therefore does not automatically reach this path.

The generic terminal package Native bridge also needs explicit resource
reachability/identity integration. Currently the ordinary plan builder discovers
used resources while compiling ordinary handler statements; package-owned
source cannot silently embed data and omit its plan/report ownership.

04 correctly demonstrated protocol admission and direct local dispatch for its
small handlers. It did **not** establish that the context application can use
02's primitives through that managed path. The dependency assumption in the 01
handoff was incomplete.

## Proposed 05A boundary

Reuse the canonical owners for Native expression admission, schema operations,
resource/workspace identity and ownership, and bounded loop accounting. Define a
versioned generic data-only projection for schema operations with pre-bound
immutable input and typed result adoption. Entities retains operation selection
and result validation; MCP retains protocol admission/framing. Resolve the exact
reuse mechanism before extending either emitter; do not duplicate the generic
compiler in the application or add a context-MCP-specific recognition path.

The prerequisite must cover:

- Existing schema text operations and all five complete output shapes, including
  nested arrays/configuration/dependency data, optional values and exact escaping.
- Literal immutable resource views, checked scalar/UTF-8 reads, selected resource
  identity, physical deduplication and unreachable payload removal.
- Invocation-owned numeric workspaces, local scalar state and the current
  1,024/65,536 loop bounds. Borrowed input/arrays remain immutable.
- Synchronous deadline/allocation failures across the package execution path.
  Failure is terminal and cannot produce partial successful tool output.
- Independent invalid/forged-plan checks and Node Native, injected Fastly Native
  and explicit JavaScript behavioral parity. Preserve existing host/Entities/MCP
  regressions; no new dependency, provider authority, fallback or general callback.

Actual files likely span the managed-handler compiler, shared Native contracts
and primitive projection, the Entities package emitter, terminal package bridge,
and provider realization where required. This is a semantic expansion of the
managed execution contract, not just declaring protected paths for an example.

Suggested sequence: contract/reuse design (Astra / High), bridge and emitter
implementation (Sol 6.1 / XHigh), adversarial/parity qualification (Sol 6.1 / High),
then resume application 05 (Sol 6.1 / XHigh). These are proposed assignments;
no separate agents or alternate models executed this investigation.

## Application draft and remaining units

The incomplete local draft is checkpointed at `27afe74` on `codex/b10-mcp-05`,
worktree `/workspace/scratch/3471f7320bf6/pulse-mcp05`. It is **not** this PR and
must not be merged: it contains generated resource/configuration experiments,
additional result schemas, a direct MCP entry and partial read/diagnostic code.
Start/example/search implementations and all application validation are still
unfinished. Its ctx-first helper attempt is rejected by managed admission.
The draft has no successful Native application result.

Resume by implementing and proving 05A, then adapt the draft to that agreed
contract. Retain the frozen exact-version, citation, applicability, Unicode
pagination and 24 KiB reply requirements. Keep production search/oracle/relevance
qualification in 06, installed closure in 07, reporting in 08, candidate-bound
freshness/seal in 09, and actual Viceroy/client proof in 10. Do not close #381,
#412 or the integrated release gate on this evidence.
