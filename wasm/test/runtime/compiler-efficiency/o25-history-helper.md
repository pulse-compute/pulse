# O-25: bounded read-only history helper proof

**Blocked at Native helper admission; sharing is not qualified.** This opt-in
proof supplies the actual bounded traversal selected by O-24, explicit inputs
and outputs, 1/2/16-call source fixtures, an expanded Native-plan control and
JavaScript behavioral checks. It makes no compiler or public-support change.

The imported helper fails with `PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED`.
Moving the identical helper into its caller's module removes the import boundary
but fails with `PULSE_NATIVE_AWAIT_UNSUPPORTED`. That second reduction shows that
module packaging alone cannot resolve this task. No Native helper plan/body or
resumable call frame is produced, so no candidate Native build is attempted.

## Measured boundary

| Registrations | Imported helper | Expanded private bodies | Effects / continuations | Lowered body bytes |
| --- | --- | ---: | ---: | ---: |
| 1 | Rejected | 1 | 5 / 5 | 20,110 |
| 2 | Rejected | 2 | 10 / 10 | 40,220 |
| 16 | Rejected | 16 | 80 / 80 | 321,766 |

The expanded control registers one authored handler repeatedly, but the Native
plan retains one private body per registration and no shared stage bodies.
The bytes measure lowered Router ranges, not AssemblyScript or final Wasm.
Native compiler invocations: zero. Binding/frame savings, Native semantic parity
and final-Wasm body attribution remain unmeasured.

Sixteen checks pass on the explicit JavaScript target's original source graph:
found/not-found; a 65-pack traversal spanning both rounds; malformed root;
corrupt, wrong-owner and missing packs; digest
failure; caller-specific failure mapping; first/second/sixteenth registrations;
and two interleavings that hold A at storage or digest while B completes, then
resume A and make a subsequent request. Failed lookup results fence the caller's
success continuation. These are JavaScript checks, not shared Native frame proof.
The synthetic bulk caller maps an error to 207; it demonstrates ownership of a
different response and does not qualify any application's full bulk-result schema.
The synthetic deep chain checks only the selected read path, not writer-produced
history or recovery-closure validity.

## Real shape and preservation

`wasm/test/fixtures/projects/shared-history-helper/src/lookup.ts` is the selected
read-only machine inside an ordinary awaited helper. Inputs are current context,
owner, immutable root hash/node and key. Output is an explicit status/code/value
record. The caller owns response creation and what executes after success.
No authority or response object is hidden in a cross-request cache.

The source retains two rounds, bounded outer/pure inner loops, a request-local
65-pack cache, `s3.getText`, `crypto.digestText`, `history.IndexPack` decoding,
owner/hash/prefix/shape checks and the existing work-limit branch. Only response
returns are adapted into result records; storage, digest and schema operations
stay as ordinary Pulse operations. The selected emitter body's original SHA-256
was `a9ea5fd5a72f4736405f80a9079669a9f3ef573db47a8dc22b007dc43f7e438d`.
The generated fixture and proof runner are individually hashed in the report.

The expanded control maps each error record back to a terminal response
explicitly. It does not pretend that helper return and handler return are the
same operation. The ordinary imported-helper fixture remains intact for the
eventual implementation to qualify.

## Exact next compiler boundary

1. The project linker currently admits imported functions as handlers/topology
   roles, not as callable effectful helpers. Its source owner is
   `wasm/packages/compiler/src/project/router-module-linker.js`.
2. Native await normalization admits trusted Pulse effects, not an awaited
   source-function call. A callee needs a separately owned result/return boundary,
   context provenance and explicit caller continuation; declaring it to be a
   trusted package effect would conflate those owners.
3. A retained callee frame must carry typed local values, loop counters, pack
   cache and the selected caller across effect suspension. Sharing cannot simply
   widen O-19's fetch-stage predicate: O-19 has no nested helper call/return ABI.
4. After admission and frame lowering exist, rerun this fixture and complete
   one-body attribution, binding/frame/continuation growth, Native normal/error
   behavior, work-limit refusal and interleaved request isolation. Include both
   middleware and terminal callers before claiming the full selected shape.

O-25's successful-sharing gate remains open. Production support and application
adoption must not be inferred from this evidence PR. Keep earlier read-only
specialization measurements separate from any future sharing gain.

## Reproduction and evidence rules

Install the lockfile-pinned workspace dependencies with lifecycle scripts
disabled, then run the TypeScript workspace build to supply package facades.

```sh
node wasm/scripts/run-wasm-tests.cjs --task shared-history-helper-o25 --no-report
timeout 90s node wasm/test/runtime/compiler-efficiency/o25-history-helper.cjs \
  --output /fresh/o25-report.json
```

The task is external evidence and belongs to no default profile. Expected direct
exit is **2**, with terminal `status: blocked` and both Native qualification flags
false. The registered runner correctly reports it as non-passing. Unexpected
fixture/runtime errors exit 1. No expected-failure flag converts this into a
successful sharing result. An incomplete report, process timeout or missing
completed checks is not evidence of completion.

The report binds committed source, dirty state, individual fixture hashes and
generated call-site hashes. It records failed Native diagnostics separately from
passing JavaScript checks and preserves the expanded control for comparison.
Output must be a fresh path. No full application, release or deployment corpus is
invoked. This experiment neither installs a new dependency nor alters a lowerer,
continuation contract, provider, compiler admission rule or production stage plan.

## Retained result

[`o25-evidence/proof.json`](./o25-evidence/proof.json) records the clean committed
proof invocation, its explicit blocked outcome and all 16 JavaScript checks.
The sibling validation record identifies the tested Git tree; per-file hashes
bind the unchanged fixture and runner after the evidence files are added.
All 35 unit-profile tasks, maintainer checks, workspace TypeScript build,
documentation checks and documentation-release validation passed.
`registered-proof.log` confirms that the opt-in task remains non-passing.
`attempts.json` and `initial-unit-failure.log` retain the earlier fixture/setup
failures and their resolutions. No failed sharing gate was reclassified as green.
