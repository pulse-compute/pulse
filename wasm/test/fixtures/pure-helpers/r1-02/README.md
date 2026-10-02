# R1-02: independent helper validation with explicit policy

Task class: behavior-preserving refactor. Base: Pulse `latest`,
`afce9f129d5c8e80099178261cbce0da6e3bb263`.

`source-helper-plan.js` re-derives operand, provenance and ownership facts after
serialization, then consumes the bounded vocabulary's operator/field/index
result facts. It loses its binary/unary result tables. Its explicit admission
policy preserves scalar callee operands, numeric arithmetic, numeric-array-only
callee indexing, and the caller's existing scalar coercion and optional-string
defaults. `in`, `void`, mutation/escape of borrowed state and callee string
indexing remain excluded. Recomputed hashes and producer tags grant no proof.
The public Native plan validation seam and all runtime/generator owners remain
byte-unchanged.

The final characterization has 521 serialized-plan cases: 320 accepted and 201
rejected. It also compiles 107 accepted scalar expressions together, checking
producer result tags against literal expectations and independent validation.
The baseline and candidate reports match exactly, including diagnostic lists,
seven source acceptance/rejection examples, generated source and plan hashes,
and the representative 2,187-byte Wasm artifact. This is output equivalence,
not a size-optimization claim.

Run `node wasm/test/fixtures/pure-helpers/r1-02/characterize-baseline.cjs` to load
only the two product variables from the pinned Git objects before running the
same characterization. Run `node wasm/test/lowering/assert-pure-helper-vocabulary.cjs`
for the candidate. Both need the pinned workspace dependencies; the baseline
also needs the base Git object. This small comparison driver is development
evidence, not a second validation implementation or release replay.

The manifest records commands, exact source hashes, checkpoints, failed test
construction and terminal gates. The original five-task baseline run predates
the test extension; the focused seven-task run predates its final 13 additional
boundary cases and producer corpus. Full required gates are pending at this
checkpoint. No merge, release, ABI, optimizer, loop-limit or application change
is authorized by this task.
