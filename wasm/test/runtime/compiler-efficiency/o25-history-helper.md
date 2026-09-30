# O-25: retained effectful history helper

**Native helper sharing is unblocked.** The compiler now admits the selected
imported or same-file read-only history function and retains one substantial
helper body for 1, 2 and 16 callers. The initial contract is deliberately bounded;
see [the canonical source-helper contract](../../../../docs/architecture/current-contracts.md#static-effectful-source-helpers-o-25).

| Callers | Helper bodies | Helper locals | Effect / continuation sites | Caller locals | Total Wasm bytes | Retained helper root bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 88 | 5 / 5 | 5 | 63,876 | 8,132 |
| 2 | 1 | 88 | 5 / 5 | 7 | 64,758 | 8,130 |
| 16 | 1 | 88 | 5 / 5 | 35 | 75,280 | 8,135 |

Each build retains exactly two helper partitions. Named companion builds match
every production non-custom Wasm section byte for byte before names are used for
attribution. Each helper partition survives once and is reachable from real
exports. Its executable body does not grow with callers. Caller bindings,
response handling and dispatch account for additional code; total source/Wasm
figures are in the proof. Timings are single observations, not a build-speed claim.
The expanded control retains 1/2/16 private bodies and 5/10/80 effect sites. It is
measured at Native-plan/source level; no expanded-control Wasm saving is claimed.

The fixture preserves the two-round traversal, bounded nested loops, 65-pack
cache, storage reads, digest verification and schema decoding. Scalar inputs are
explicit. The helper returns a code/status/value record; callers own failure
mapping and the success continuation. All five effects remain trusted package
operations, with their helper and continuation ownership recorded in the plan.
The original emitter fragment SHA-256 is
`a9ea5fd5a72f4736405f80a9079669a9f3ef573db47a8dc22b007dc43f7e438d`.

The proof runs 16 checks each on compiled Native and original-source JavaScript:
found/not-found, 65 packs across both rounds, malformed roots, corrupt/wrong-owner/
missing packs, digest failure, distinct caller mapping, registrations 0/1/15,
interleaved requests held at storage and digest, and a subsequent clean request.
It repeats all 16 Native checks with a middleware caller. A separate fixture
reduces both round caps to zero to test defensive work-limit return parity on
Native and JavaScript; the real fixture's bounds are unchanged. This deliberately
avoids inventing a valid cryptographic hash cycle to exhaust the defensive bound.

The plan task adds 11 source rejection cases, 12 rehashed-plan mutation cases,
and focused Native lifecycle checks: sequential re-entry, middleware, terminal
host-failure fencing, application-error transfer, stale/foreign tickets and a
Fastly compiled/injected-host parity check. The history proof uses injected
storage and SHA-256 host effects; it is not deployed-provider qualification.

## Compiler boundary

- Project linking resolves the immutable source-function owner. Direct awaited
  local bindings in HTTP routes or middleware supply the current context and
  proven scalar inputs. Shadowed bindings and unsupported call forms fail closed.
- Handler IR emits one helper generator body. Native plan v5 retains its own
  local namespace, parameters, result kind and effect/continuation sites.
- Generator v7 stores a return program counter and error destination in one
  invocation-owned frame. Locals reset on entry, survive effects and return to
  the selected caller. No live call stack, generic Promise runtime or new host
  effect/ABI is introduced.
- Serialization validation rejects crossed locals/sites/continuations, nested
  calls and calls outside their owning HTTP admission branch. Existing read-loop
  memory limits and provider value analyses inspect helper bodies too.

Captures, recursive/nested helpers, function-valued inputs, caller-loop calls,
effect groups and helper-owned responses/Router transfers remain unsupported.
The first parameters are `ctx` plus one or more explicitly typed scalar inputs;
package lowerers retain their existing source-form restrictions. JavaScript keeps
its original source graph. No package import gains lowerer authority.

The synthetic bulk caller's 207 response demonstrates caller ownership, not an
application's full administrative result schema. The deep fixture qualifies the
selected read path, not writer/recovery closure correctness. Whole-application
adoption and comparison remain separate work; earlier read-only specialization
savings must stay separate from sharing gains.

## Reproduction and history

```sh
node wasm/scripts/run-wasm-tests.cjs --task shared-history-helper-o25 --no-report
node wasm/test/runtime/compiler-efficiency/o25-helper-unblocked.cjs \
  --output /fresh/o25-report.json
```

The opt-in measurement task remains outside default profiles, with a finite
180-second timeout. It fails if sharing, semantics or final-Wasm attribution
fails. The mandatory Native plan task runs the smaller ownership/lifecycle suite.
Reports bind source commit, working-tree state, fixture hashes and plan hashes.

The earlier [blocked proof](./o25-evidence/proof.json) and its failed attempts
remain historical evidence from the pre-implementation tree. They are not
reclassified as passing. Follow-up evidence records the successful implementation,
validation scope, setup failures and development corrections separately.

The [clean committed proof](./o25-unblocked-evidence/proof.json),
[validation record](./o25-unblocked-evidence/validation.json) and
[development attempts](./o25-unblocked-evidence/attempts.json) record the follow-up.
The CLI profile retains two size-snapshot failures that reproduce on the unchanged
baseline; its resumed coverage is not a passing release replay.
