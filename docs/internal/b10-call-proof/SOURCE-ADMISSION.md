# Static call source admission: checkpoint 2

Historical admission checkpoint. [05B](./05B.md) now connects these facts to
ordinary named plain Native project compilation and caller lowering. The
admission function itself still reports `callerValidated: false` and
`runtimeWired: false`; those properties describe this pass, not the complete
project compiler. The remaining text records checkpoint 2's original boundary.

Implemented privately in `wasm/packages/compiler/src/callable-source-admission.js`.
Normal project compilation does not invoke it and still rejects `ctx.call`.
No public API, runtime wiring or context-mcp migration is included.

`admitCallableSource(graphBuild, { schemaBundle, binaryResources })` takes the
ordinary Native project graph and the existing schema/resource inputs. This
first slice accepts a named plain entry handler and **one imported named
synchronous project function**, used at up to 16 source call sites. Router,
managed MCP, installed-package and multiple-target admission are deferred.

The existing linker now exposes a private function-resolution seam. It delegates
to the same local/export resolver used by handlers/helpers; ordinary linking is
unchanged. Named imports, aliases and named re-exports resolve to one defining
module/function identity. Uncalled functions are not compiled as callees.

The admission pass recognizes direct context calls, requires an unshadowed,
unwritten context and target binding, and validates two literal registered
schema IDs. A target cannot use conflicting schema pairs. Unsupported target
forms, schema options, loops, nested calls/functions, awaited calls and excessive
sites fail with diagnostics. Binding rejection is intentionally conservative,
like existing helper admission: even a shadowing declaration elsewhere in the
entry body prevents admission.

The callee then passes through `compileCallable`, ordinary canonical computation
admission, shared readonly-input validation and independent Native plan
validation. Effects, HTTP authority, input mutation and nested callee operations
remain unsupported. No second execution engine or schema registry is added.

The result contains callee plans and call-site identities, locations and argument
AST nodes. It explicitly reports `callerValidated: false` and
`runtimeWired: false`: it does not validate/lower the rest of the caller, infer
argument types, execute calls or establish an executable application plan.
Only matched direct context calls produce facts; ordinary objects with a `call`
method acquire no callable meaning.

## Evidence and remaining boundary

The `callable-source-admission` unit task covers positive resolution, identity
deduplication, schema checks, ownership/authority rejection and preservation of
ordinary compiler rejection. It uses the real project graph and schema bundle,
then independently validates the admitted callee plan; it emits no Wasm.

Run:

```bash
node wasm/scripts/run-wasm-tests.cjs --task callable-source-admission --no-report
```

The test is also registered in the ordinary unit profile and release evidence
map. Its source/checkpoint receipt distinguishes focused development checks from
full profile qualification. The previously passing backend execution evidence
is historical for this new source tree; no fresh runtime or unused-Wasm claim
is made for this checkpoint.

Next: lower one admitted call in the named entry handler through ordinary caller
validation into the existing callable backend. Stop after one real authored
HTTP execution and its zero-use regression. Router/managed MCP integration and
public contracts remain later checkpoints.
