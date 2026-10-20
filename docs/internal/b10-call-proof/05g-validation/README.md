# 05G checkpoint evidence

The two atomic runner reports retain their original source identity and log paths.
Complete selected task logs are copied into `tasks/`; basename matching preserves
original log contents. `baseline-final.json` retains full Wasm hashes, sizes and
imports and the clean tested revision. The documentation receipts hash the large
local inventory logs; those logs remain at their recorded development paths.
No report is a release qualification or a full-profile checkpoint.

Development attempt 1 caught the schema extractor following a nonrelative runtime
type import; the example now separates schema shapes. Attempt 2 passed a normalized
plan to its constructor instead of its input shape; the test now reconstructs that
shape and also tests loader/source realization. Attempt 3 resolved a relative
caller diagnostic path against the repository instead of the fixture root; the
assertion was corrected. Attempt 4 passed, followed by the final clean run.
The initial build required regenerating diagnostic-derived context resources;
see `development/build-first-attempt.txt`. No failed attempt is counted as passing.
