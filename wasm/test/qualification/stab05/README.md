# STAB-05 compiler replay and failure quality

Run from the repository root with restored, pinned dependencies:

```sh
node wasm/scripts/run-wasm-tests.cjs --task cli-stab05-compiler-replay --task cli-diagnostics
```

These generic reductions separate current restrictions from old failures and
diagnostic defects. They contain no downstream application source. The replay
checks 21 source cases and three independent RS256 build controls. Eight source
cases compile and execute on workspace Node Native; thirteen remain rejected.
Admission, compilation and execution are reported separately. This is not an
installed-package, Fastly, hosted, whole-application or performance qualification.

| Shape | Current result | Classification |
| --- | --- | --- |
| Scalar helper, string indexing, required schema field | Compiles and executes | Supported controls; old string-index rejection is resolved |
| Dominating optional-string guard | Compiles and executes | Supported; unguarded optional input remains rejected |
| Scalar-only record spread | Compiles and executes | Supported bounded provenance |
| Spread of a schema record containing a record array | Argument remains `unknown` | Provenance gap outside the bounded borrowed-record vocabulary |
| Schema record-array element field, directly or inside a bounded loop | Argument remains `unknown` | Retained scalar-provenance gap; a scalar runtime value alone is insufficient proof |
| String/record-array helper parameters, nullable record parameter, structured return | Signature rejected | Intentional helper contract restrictions |
| Pure helper and sequential read helper inside a bounded loop | Compiles and executes | Old blanket call-in-loop restriction is resolved |
| Combined caller/callee iteration product above 65,536 | Rejected | Intentional work bound |
| Write helper inside a read loop | Independent plan validator rejects the effect | Correct rejection, remaining source-diagnostic gap |
| Arbitrary `Record<string, unknown>` and index-signature schemas | Rejected | Intentional schema vocabulary restrictions |
| `JsonObject` as the schema root | Rejected | Object-root requirement |
| `JsonObject` inside a declared object property | Compiles and executes | Supported alternative for dynamic properties |
| RS256 alone | CLI build succeeds | Independent signature-guest control; no request execution claim |
| RS256 + MAC text; RS256 + explicit schema decoding | Both CLI builds fail with `PULSE_GUEST_UNIT_START_MISMATCH` | Two independent composition blockers; neither is qualified by the baseline |

## Diagnostic repair

The observed guest-link failure previously exited 1 with an uncatalogued
internal diagnostic. It now exits 3 and carries compile classification, public
stability, specific remediation and an exact-version documentation anchor.
The forbidden-start audit remains intact. A component compiling by itself is
not evidence that its allocating compositions work.

The replay also exposed uncatalogued helper-signature, helper-argument,
Router-compilation and schema-shape failures. They now have exact catalog
entries. Nested argument kind details and source positions remain visible.
Loop remediation now acknowledges supported helper calls and the combined
iteration bound. No new diagnostic family fallback hides unknown internal errors.

The write-helper case still reaches independent plan validation. It is retained
as a diagnostic-quality gap, not described as a source-level diagnostic repair.
The test does not weaken that validator or treat the rejected program as admitted.

## Compiler efficiency evidence

Historical large-build WAT rendering failures do not establish a current
regression. Current default compilation omits WAT, and each positive replay
asserts that default without explicitly disabling text output. No representative
large-build timing or memory comparison was performed here; no performance
improvement or absence of other compiler inefficiencies is claimed.

The next implementation work requires separate scope: improve record-array
scalar provenance, diagnose disallowed helper effects earlier, and realize the
two allocating signature-guest compositions without bypassing initialization
or memory contracts. This replay does not expand accepted syntax or select a
different target automatically.
