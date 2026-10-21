> Historical blocked checkpoint. The user-authorized error-boundary repair and complete passing rerun are recorded in [REPAIR.md](./REPAIR.md). Original failed receipts below remain unchanged.

# 10A blocker: generic bounds errors become empty HTTP 200

## Observed failure

The exact installed Native generic-resource fixture, executed through Fastly CLI
16.1.0 and Viceroy 0.21.1, returns status 200 with an empty body for both:

- `mode: bounds`: negative index in a request-owned numeric workspace;
- `mode: resource-bounds`: `readU32LE(byteLength)` on a mapped binary resource.

Both paths must reject the request; the qualification fixture expects HTTP 500.
An empty success response is not a valid rejection. The registered gate remains
failed. This is neither a provider-real qualification pass nor a release waiver.

The independent replay of the retained Wasm also reproduces both outcomes.
Normal requests before/after each error return the full expected JSON. A single
heavy callee returns `4194304`; cumulative heavy calls trap with `unreachable`
and return HTTP 500, followed by a successful normal request. These observations
do not establish guest live-allocation counts or absence of memory leaks.

## Owning path and bounded repair

`packages/provider-fastly/src/build/native-binary-resources.js` implements
`host_workspace_check` and `host_resource_check`, recording the generic failure.
In `packages/provider-fastly/src/build/native-platform-capabilities.js`, the
invocation driver calls `__pulse_fastly_jwt_send_error()` when the provider error
is set and returns. That generated helper is empty when JWT is absent. Inspection
therefore explains the observed lack of a downstream error response; the real
host behavior is independently captured in the receipts.

Next action: repair the provider's generic fatal-error response path in a
separate bounded implementation unit, preserving JWT behavior, invocation
cleanup, explicit targets and error authority. Add focused failure-response
coverage, then rerun `mcp-fastly-local-installed` in full on the reviewed head.
Do not weaken the acceptance assertion, add a backend/JavaScript fallback, or
claim success from the historical successful tool cases.

Issue #458 explicitly says to record a semantic dependency instead of absorbing
a second implementation project. No provider runtime change was made in 10A.
The PR remains draft and #458 remains open until actual local acceptance passes.
