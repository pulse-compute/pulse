# B10 — shared callable composition proof

Current application checkpoint: [B10-MCP-05I](./05I.md). Bounded imported
computations execute through shared `ctx.call` in plain HTTP, Router and managed
MCP callers on Node Native, Fastly Native and explicit Node JavaScript. 05G adds
public types, contract documentation, diagnostics and versioned callable metadata.
The backend-proof measurements below remain historical evidence.

Status: **public contract prepared for human review on draft #442; not completion
of B10-MCP-05**. Application migration and final acceptance remain separate units.

## Human direction and superseded work

On 2026-10-19 the user redirected the managed Native work toward internal calls:
reuse ordinary computation machinery and constraints, accept moderate cost at
call sites, require zero or near-zero compiled Wasm cost when unused, and roll
back the Entities primitive expansion. The user then directed “Proceed with the
new plan.” This authorizes the proof and necessary cross-owner changes, not
merge, npm publication, deployment, or self-approval.

The branch starts at `8a51d705025c69ae306004215cb6cb48248d68e1` (`latest`). It does
not contain the B10-MCP-05A implementation from PR #438. That draft and its
`codex/b10-mcp-05a` branch preserve the original experiment. Earlier resource,
workspace, corpus-generation, and MCP protocol work remains intact. The existing
application draft on `codex/b10-mcp-05-wip` remains unqualified.

No single Entry Point covers this cross-owner experiment. Root, wasm/compiler,
packages, Fastly, docs, and release instructions apply. Classification:
architecture. The release shard change registers only the new proof test.

## What is implemented

An internal frontend normalizes one `(ctx, input)` function's input parameter,
then delegates its body to the ordinary canonical frontend, plan builder,
independent plan validator, and AssemblyScript generator. It does not implement
a new expression evaluator, loop emitter, workspace store, or resource reader.

The versioned private callable descriptor binds an input local and input/output
schema IDs. The ordinary generator emits the body in a private namespace.
A small invocation adapter resets the frame, projects/copies the read-only input through
existing schema codecs, invokes the body, validates/copies the result, and clears
its handle roots. Existing request deadline checks and Native value/guest-memory
bounds apply cumulatively when calls are present. The proof does not suspend or
catch callable failures. The existing helper borrow/alias validator is shared
with callables, so direct and aliased input mutations are rejected before emission.

Entities receives only a callable-expression adapter (boxed JSON value to the
shared value-handle boundary and back). Its interpreter does not learn resource,
workspace, mutable-scalar or loop operations. The 05A undefined/coercion changes
are absent. Fastly binds the existing canonical host operations, including f64
results and arbitrary compiler-generated argument names.

The adapter currently uses bounded internal JSON/schema round trips. This is
value conversion inside one Wasm instance, not HTTP, JSON-RPC, a second Wasm
instance, or JavaScript fallback. Copying cost is intentionally visible and needs
measurement with the real corpus/result sizes. Zero-copy is not claimed.

## Evidence and limitations

The executable proof inserts call-site facts at compiler-plan boundaries. It
**does not** resolve `ctx.call(target, input)` from application source, register a
public callable declaration, or establish imported-helper composition. The MCP
protocol and dispatch are real; the internal call-site producer is experimental.
This separation avoids mistaking a successful backend experiment for authoring
support.

One computation reads an embedded resource, fills an invocation-owned workspace
inside a bounded loop, reads UTF-8, and returns a schema-bound record. HTTP and
MCP invoke that same callee plan. Node Native and injected Fastly Native results
are compared with direct JavaScript execution of the authored computation.

The initial measurement run produced:

| Entry | Call sites | Node Wasm bytes | Fastly Wasm bytes |
| --- | ---: | ---: | ---: |
| HTTP | 0 | 42,902 | 89,334 |
| HTTP | 1 | 45,470 | 90,260 |
| HTTP | 2 | 45,504 | 90,295 |
| HTTP | 16 | 45,854 | 90,646 |
| MCP | 0 | 100,239 | 130,609 |
| MCP | 1 | 102,154 | 145,554 |
| MCP | 2 | 102,234 | 145,634 |
| MCP | 16 | 102,766 | 146,167 |

Both zero-call fixtures were compiled with the untouched baseline toolchain and
this toolchain: **identical complete Wasm SHA-256 hashes on both targets**. This
also implies identical imports for these fixtures. The first-call deltas include
the example computation, resource payload, adapters and containment machinery;
they are not a universal per-call tax. Nonzero measurements are fixture-specific.
Compile timings are single local observations, not a performance benchmark.

The private v1 proof admits at most 16 callee slots and 16 ordinary call sites,
rejects retained unreachable callees, nested callees, calls inside loops,
recursion, effects, request/response/state authority and unknown schemas or
resources. Resource and schema identities must agree with the caller. Existing
loop limits remain canonical. This does not qualify arbitrary forged package
source: package lowerers remain trusted build dependencies.

Run the ordinary regression task:

```bash
node wasm/scripts/run-wasm-tests.cjs --task callable-composition-proof --no-report
```

For the additional byte-for-byte baseline comparison, use an untouched checkout
with the same dependencies and pass its path explicitly:

```bash
node wasm/test/callables/assert-callable-proof.cjs /path/to/baseline /tmp/callable-proof.json
```

The baseline comparison is additional development evidence, not a substitute
for candidate qualification. Dependencies were restored from the prior
lockfile-pinned worktree; no fresh clean installation or packed-consumer claim.
Actual Viceroy/Fastly service and external MCP clients are not exercised.

## Next implementation boundary

1. Decide the callable declaration using existing schema ownership, then connect
   static imported references and `ctx.call` to the existing linker. No runtime
   string registry or scanning. Prune unreachable callees before emission.
2. Replace the proof's manual call-site producer with validated compiler output
   for HTTP and managed callers. Extend versioned contracts and installed mirrors
   deliberately; do not present private proof fields as public support.
3. Reuse ordinary helper/imported-scalar ownership inside callable bodies. The
   proof frontend currently accepts one standalone function and no helpers.
4. Review input ownership, scalar provenance, early returns, nested results,
   exceptional cleanup, structured failures, source maps/report attribution,
   multi-callee resource deduplication and independent plan validation. Full
   negative envelope parity and recovery after a trapped call remain unproven.
5. Qualify memory/CPU behavior with real query sizes and close lifetime/rooting
   questions before enabling effectful or nested call graphs. Reuse existing
   suspension machinery; do not design a parallel scheduler.
6. Move context-mcp computations onto the supported call path, finish all five
   outputs and deterministic generated configuration, then resume the remaining
   B10-MCP acceptance gates. The vector freshness/seal work remains required.

The zero-use fixture gate must stay byte-identical unless an explicitly reviewed
change explains a measured difference. Keep PR #438 as historical evidence;
do not resume its Entities primitive expansion.

## 05C continuation

[05C](./05C.md) extends the authored Native path with existing pure helpers,
scalar imports and multiple callable owners. This remains the draft #442
lineage; the earlier proofs above retain their historical evidence boundaries.

## 05D continuation

[05D](./05D.md) adds the explicit Node JavaScript call boundary and same-source
parity. [Validation and handoff](./05D-VALIDATION.md) records this checkpoint.
Router and managed MCP callers remain 05E.

## 05E continuation

[05E](./05E.md) connects reachable Router and managed MCP callers to shared
`ctx.call` on Native and explicit Node JavaScript. [Validation](./05E-VALIDATION.md)
records the focused integration checkpoint. Next: 05F (#447).

## 05F continuation

[05F](./05F.md) hardens frame cleanup, terminal failures and cumulative request
budgets, including resource-free Fastly callable instrumentation.
[Validation](./05F-VALIDATION.md) records the focused checkpoint. Next: 05G.

## 05G continuation

[05G](./05G.md) finalizes public computation types, source-bound documentation,
diagnostics and stale metadata rejection. `05G-VALIDATION.md` records the focused
checkpoint. Next: 05H (#449).

## 05H continuation

[05H](./05H.md) completes the migrated `pulse.start` application, its deterministic
config/tool metadata and three-target MCP behavior. The v1 five-tool host remains
available during migration. `05H-VALIDATION.md` records this checkpoint. Next: 05I
(#450), migrated read/example/diagnostic.

## 05I continuation

[05I](./05I.md) completes cited read/example/diagnostic alongside `pulse.start`,
with exact Unicode pagination and response bounds on all three targets.
`05I-VALIDATION.md` records the checkpoint. Next: 06A (#451), sparse lexical search.
