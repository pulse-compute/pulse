# Static call authoring: checkpoint 1

Status: the initial resolution characterization and prototype contract below
are followed by a private source-admission implementation. See
`SOURCE-ADMISSION.md`. No public export or executable `ctx.call` support is enabled.

## Smallest next implementation

Use an ordinary exported named function as the target. Bind the existing
registered input/output schemas explicitly at the call site for this first
prototype. This avoids a new callable factory, registration table or schema
inference mechanism while validating the actual compiler path.

```ts
// query.ts — illustrative prototype, not supported authoring syntax
export function query(ctx, input) {
  return { value: input.value + 1 };
}

// handler.ts
import { query } from './query';
const result = ctx.call(query, input, {
  inputSchema: 'app.Query',
  outputSchema: 'app.Result',
});
```

The example shows the intended expression inside an existing handler. Schema
IDs remain owned by the ordinary project schema registry. It is deliberately
verbose at the call site, consistent with the accepted tradeoff. Declaration
sugar and schema binding at the target can be considered after this path works;
neither is needed to prove statically resolved source admission. This is a
prototype decision, not a public compatibility promise.

## Findings from executable characterization

The unchanged project graph/linker resolves named imports, import aliases and
named re-exports to the same defining module/function. Two aliases of the same
function produce one helper identity. The probe observes those results through
ordinary helper discovery; it does not claim callable discovery already works.

Passing that imported function as the first argument of `ctx.call` instead
produces `PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED`: the current linker
does not consume the reference. This isolates the first required change. Reuse
its existing `resolveLocal`/`resolveExport` machinery in the same linker rather
than introducing a second resolver. Preserve resolver diagnostics and cycle,
ambiguity, package and source ownership rules.

The first probe attempt expected the wrong diagnostic spelling and failed its
assertion. The corrected probe uses the observed canonical code. Both attempts
are retained; no compiler change was made to satisfy the expectation.

Run: `node docs/internal/b10-call-proof/probes/static-linker.cjs`.

## Prototype admission boundary

- Recognize `call` only on the canonical context binding; a similarly named
  application object grants no special behavior.
- Target is a static local identifier resolving to a named project function.
  Named import aliases and named re-exports use existing symbol resolution.
  Namespace/member targets, computed targets, factories and dynamic selection
  stay outside the first slice. Installed-package targets are a later gate.
- The callee is synchronous `(ctx, input)` with schema-bound object input and
  result. The callee receives only the computation operations already admitted
  by the execution proof. No HTTP/state authority, effects, nesting, recursion,
  suspension or calls inside loops.
- Schema options are a literal object containing literal `inputSchema` and
  `outputSchema` IDs, both present in the ordinary registry. A reachable target
  must have one consistent schema pair; conflicting pairs are rejected.
- Discover from reachable caller bodies. Deduplicate by resolved module and
  function identity, not local alias or a runtime name. Use deterministic
  ordering, retain source attribution and reject unresolved references before
  code generation. Preserve existing import behavior for projects without calls.
- Reuse the proof's limit of 16 callees and 16 call sites. This does not promise
  arbitrary multi-callee behavior before its dedicated ownership tests.
- Input remains read-only using the shared borrow/alias validator. Caller and
  callee schema/resource identity must agree. Internal schema conversions,
  cumulative deadlines and memory/value bounds remain explicit costs.

## Existing owners and the next stop

| Work | Existing owner to extend |
| --- | --- |
| Target resolution and source identity | `project/router-module-linker.js`, using its current resolver |
| Context recognition and source admission | Canonical handler frontend and expression lowering |
| Schema lookup | Existing project schema registry/bundle |
| Callee admission and validation | Private callable frontend and independent canonical plan validator |
| Execution and containment | Shared callable backend already exercised by the proof |

The next checkpoint is **source admission only**: resolve one imported target
and literal schemas into validated callable facts, with positive and negative
fixtures. Stop before runtime/public type work or context-mcp migration. After
that, wire one authored call end to end and rerun the unused-Wasm gate. Managed
MCP authoring, JavaScript parity and public contracts each remain explicit work;
the router linker probe does not establish them.

No new registry is necessary. The principal open work is connecting existing
owners, preserving reachability and extending source validation deliberately.
