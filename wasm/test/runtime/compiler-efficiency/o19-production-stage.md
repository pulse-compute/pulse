# O-19: production shared-stage lowering

O-19 moves the O-18 mechanism into versioned Native plan records, validation and
default emission. No handler-ID option or emitter-local plan clone is required.
The bounded family is a transfer-capable HTTP route with 1..64 sequential bound
text-fetch sites, pure statements/branches and terminal response/next/error
outcomes. An ineligible family retains existing Native lowering. This is not a
new general-purpose callable function API.

The planner owns stage inputs, outputs, locals and registration bindings. It
compares both bodies and effect inputs before factoring, removes redundant plan
bodies and locals, and preserves original effect/continuation identities and
source attribution. Effect inputs/results refer to stage-owned locals; each
registration retains its own host effect slots. Continuations explicitly record
the owning stage/site as well as their original registration. The actual plan is
hashed, validated and serialized; malformed ownership is rejected even after
rehashing. The emitter consumes those records and emits each stage once under
the existing chunk limits. Request-owned frame state survives suspension and
resets at stage entry. No nested stage stack is introduced.

Frontend Router source expansion remains. This is not a frontend compilation
cost or whole-application size claim. O-20 generator composition and O-21's
application comparison remain separate work.

## Checks

```sh
node wasm/scripts/run-wasm-tests.cjs --task shared-stage-o19 --task reusable-stage-o18 --no-report
```

`shared-stage-o19` belongs to the Native profile. It checks:

- Invalid effect, continuation, cursor, local, output, frame and call ownership
  after JSON serialization and a recomputed plan hash.
- Conservative retention of ordinary lowering for changed body/input, captured
  local, grouped effects, read loops and a wrong entry kind.
- Two distinct stage families with one and three sequential sites, each reused
  by 17 registrations, without an error handler. Both Node and the injected
  Fastly ABI fixture execute exact responses and outbound order at the first,
  middle and final registrations.
- Request-body reads and string trimming occurring only inside a shared stage,
  so provider analyses must follow the new records.
- Serialized plan compilation, deterministic identity and a registration-aware
  dispatcher guard allowance.

The opt-in `reusable-stage-o18` task supplies paired fresh-worker 1/2/16
measurements, byte-exact named companions for real optimized Wasm, fixed shared
body partitions, early responses, explicit error transfer, fatal Native transport
failure, suspension/resumption, interleaved request isolation and same-request
re-entry. Its controls verify wrong-registration, incomplete, duplicate and
stale settlement. Timing is one observation per cell, not a performance claim.

Development failures are retained in the task handoff: the first multi-family
fixture accidentally used independent fetches (which correctly grouped and
remained ineligible); the no-error-handler case exposed a missing conditional
error guard; a temporary guard declaration placement failed generation. The
negative mutation fixture was changed to JSON roundtrips so mutating one
registration would not also mutate a shared input object in another.

No deployed Fastly, cancellation, latency or peak-memory qualification is claimed.
The PR records exact tested source identity, aggregate validation and any
baseline-reproduced failures.
