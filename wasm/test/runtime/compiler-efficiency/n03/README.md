# N-03: guarded flat-record scalar projections

Implements the first slice selected by N-01: caller projections from literal-schema arrays of closed elements with exactly two required string fields. Only scalars cross existing helper boundaries.

Independent validation reconstructs origin, const aliases, dominating bounds and index lifetime. Writes, structured escape and suspension-crossing reads reject. Whole-array/element helper signatures, optional/deep shapes, string arrays, ABI and loop budgets are unchanged.

## Completed proof

- Unit/native/javascript/conformance: 110/110 tasks passed.
- Official installed packages: 21 matrix cases (9 admit, 12 reject), 216 executions across JavaScript, Node Native and the local Fastly host fixture, 23 source rejections, 18 rehashed-plan rejections.
- Module audit: zero workspace product modules. All 988 installed Pulse files matched 19 official tarballs before and after proof.
- Official TypeScript/package build, maintainer/docs checks and installed-documentation release simulation passed.
- CLI: 22 tasks completed; 20 passed. Two documentation size assertions reproduced the S-03 baseline exactly: 47,185 versus expected 47,135 and 9,157 versus expected 9,762. The CLI profile is not green.

| Unchanged inline control | Before Wasm | After Wasm | Gzip-9 delta |
| --- | ---: | ---: | ---: |
| Node Native | 23,013 | 23,013 | +2 |
| Fastly Native | 71,721 | 71,721 | +3 |

Both executable code sections are byte-identical. No application extraction saving or deployed-service result is claimed.

## Reproduction and identity

The registered `flat-record-projections` task contains the generic runtime, source-rejection and independently rehashed-plan cases:

```sh
N03_OUTPUT=/tmp/fresh-n03.json node wasm/scripts/run-wasm-tests.cjs \
  --task flat-record-projections --report /tmp/fresh-n03-run.json
```

`N03_PLAN_ONLY=1` is development-only, not runtime proof.

Qualified public code commit: `5d89239937a715807aca8230fb8237142f61214f`.
Packed local source: `c3b7e4a6bd1f4f037b6fc52e24876c9547eddd11`.
Both share tree `a73704ba05eb02c793defb0a6f10d329644657c4`.
This later summary does not change package inputs.

The user requested recovery with proof only and no further check gates. Existing completed results are reported above; none were rerun during recovery. Larger raw evidence remains in the execution workspace. Internal process logs and private consumer data are excluded from this public PR. No merge, publication, deployment or release seal is authorized by this proof.
