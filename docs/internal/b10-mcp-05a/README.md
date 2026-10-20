# B10-MCP-05A — combined Native proof

This branch implements the first, bounded architectural proof for
[#436](https://github.com/pulse-compute/pulse/issues/436). **It does not complete
05A or B10-MCP-05.** The application draft remains separately checkpointed at
`27afe74` on `codex/b10-mcp-05`.

Human direction: after reviewing the managed-execution prerequisite, its risk,
and the sequence “prove the architecture, then complete the implementation,”
the user said **“Ok proceed”** on 2026-10-19. This authorizes the bridge direction
and subsequent 05 implementation. It does not authorize merging, publication,
deployment, or self-approval of protected boundaries. No further permission is
needed for the remaining implementation within that direction.

Base: `8a51d705025c69ae306004215cb6cb48248d68e1` (`latest`, merged readiness PR
#437). Branch: `codex/b10-mcp-05a`. No single Entry Point covers this work; the
root, compiler, package, Fastly and documentation instruction chains apply.
The necessary validation registration also touches the existing release test
shard mapping, without changing release policy or publication authority.

## What the proof establishes

One actual managed MCP operation combines literal resource views, scalar and
strict UTF-8 reads, an invocation-owned numeric workspace, mutable scalar state,
bounded nested loops, schema text decode/encode and a full nested typed return.
It executes through the package-owned MCP/Entities dispatch on Node Native,
injected Fastly Native and explicit Node JavaScript. The ordinary Native
resource/workspace emitters and source ownership/loop validators are reused.
No application name, corpus layout, publisher allowlist, fallback or new
production dependency is introduced.

The bridge carries a versioned generic data-only primitive description. Managed
IR/bundle v3 and private Native facts/bundle v2 record the expanded vocabulary.
Resource reachability enters the ordinary Native plan, so aliases share one
physical blob and unreachable data is excluded. Workspace ownership is validated
per selected managed handler. The terminal compiler composes shared runtime
source after the trusted package contribution; packages do not inject arbitrary
source through primitive facts.

The focused proof covers seven successful shapes, including nested arrays,
optional absence/presence, supplementary Unicode/NUL, loop break/continue,
65,536 bounded nested iterations and fresh workspace state. It compares all
three targets with independently computed output values. Negative cases cover
invalid ranges, non-scalar UTF-8 boundaries, workspace indices, malformed/schema
invalid JSON, growing scalar overflow, source ownership/loop limits, forged
plan references and synchronous deadline expiry on both Native targets.
Present `undefined` is separately rejected by all three targets. Canonical
schemas distinguish that value from an absent optional property; the draft
application's conditional-undefined construction must be replaced accordingly.

Existing Native execution-wide value accounting and a 256 MiB maximum guest
memory are activated for plans using the bridge. This is containment, **not** a
measurement of worst-case context-mcp memory or evidence of installed resource
closure. No Viceroy, real Fastly service or external MCP client proof is claimed.

Run the focused proof:

```bash
node wasm/test/entities/assert-managed-native-primitives.cjs /tmp/managed-native-proof.json
```

The receipt includes exact Wasm/plan hashes and the modified/untracked source
file hashes. The task is registered as `managed-native-primitives`, in the Native
profile and its existing release shard. Earlier failed attempts must remain in
the work log; a passing focused run is not an aggregate release seal.

## Remaining before 05A / 05 completion

- Review the new projection and emitter as production code, especially scalar
  provenance, schema failures, multi-handler workspace ownership, interaction
  with effects, allocation exhaustion and independent forged-plan validation.
- Complete the regression profiles and TypeScript build; record dependency-bound
  failures honestly. The restored dependency bundle was copied from the previous
  lockfile-pinned worktree. A fresh offline dependency installation has not passed.
- Adapt the application draft to admitted source. It currently relies on a
  ctx-first helper and imported scalars that managed admission does not yet
  support. Determine reuse of the existing ordinary source/helper owners before
  adding any bridge; do not copy a second general compiler into Entities.
- Complete all five application outputs. Start/example/search plumbing is still
  missing from the draft. Finish exact-version/citation/applicability behavior,
  Unicode UTF-16 pagination and the 24 KiB tool-result budget.
- Make the manifest/configuration template deterministic generator-owned output;
  the draft's manually materialized configuration is not an acceptable final
  workflow. Regenerate canonical and installed mirrors from their owners.
- Qualify the real corpus and all five complete result schemas across Node
  Native, Fastly Native and JavaScript. Keep production retrieval/relevance in
  06, installed closure in 07, physical reporting in 08, mandatory freshness/seal
  in 09 and actual Viceroy/client acceptance in 10.

The successful composition proof reduces architectural uncertainty. It does not
justify calling the remaining work a small cleanup or closing #436, #381 or #412.
