# B10-MCP-03 validation

Development evidence on base `014496136a5357747efd08c32094ca9830f5bb01`,
2026-10-19. Exact receipts: [builder-proof.json](./builder-proof.json),
[native-proof.json](./native-proof.json), and [checks.json](./checks.json).
The Native receipt binds all 29 changed product/test/generated files before
these audit documents were added; every recorded source hash was rechecked.
The context manifest independently binds the finite producer/input/output closure.

## Passing checks

- Pinned Node 24.18.0: 93 builder/admission cases, including actual independent
  author builds in two unrelated fresh roots. Creation/enumeration order,
  locale/timezone and home/cache locations differ; no shared output cache is used.
- Verifier Node 24.19.0: the same 93 cases and byte-exact reconstruction. Unpinned
  author generation is rejected; this is not a promise about untested Node versions.
- One final registered run: `pulse-context-build`, `pulse-context-corpus`,
  `pulse-context-application`, `pulse-context-host`, `context-native-proof`.
  All five tasks completed with terminal passes and exit 0 in 91.11 seconds.
- Native proof: 153 parity executions, actual 245-record corpus and 512-record
  growth fixture; injected Fastly ABI, Node Native and original-source JavaScript.
  The builder test independently compares the production binary encoding with
  the 02 fixture encoder byte-for-byte. This does not claim finished MCP transport
  or real Fastly CLI/Viceroy execution.
- Repository TypeScript build, maintenance check, docs synchronization/check,
  documentation release validation, documentation orchestration probes,
  publication control-plane check and release preflight all passed.
- Scope declaration passes with human review required. The classifier leaves
  the four context builder/extractor script paths unclassified; their owners and
  authorized scope are explicitly declared, without widening routing policy.

Negative evidence includes changed source/allowlist/version/status, each producer
source and compatibility source, config/weights/normalization/producer/lockfile,
every canonical and mirrored output, missing/extra/symlink files, malformed Unicode,
invalid and wrong-but-in-range coordinates, mixed generations, forged self-consistent
manifest hashes, invalid offsets/counts/truncation/trailing bytes and schema/content
mismatch. Candidate files are hashed before and after each failed check. The growth
case exercises all 512 rows and 4,096 terms with complete 1,024-entry rows; a combined
maximum that exceeds the independent corpus byte budget is rejected.

## Environment and limits

Node 24.18.0 came from the official nodejs.org distribution. Archive SHA-256:
`55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`, verified against
the published checksum list. The 19 existing dependency directories from the prior
lockfile-matched work environment were reused; no fresh dependency installation
or clean-machine package acceptance is claimed. The independent producer roots
have only the explicit source closure, no node_modules or Git repository.

An initial focused runner command mistakenly named the nonexistent
`documentation-check` task and failed before running tasks. The corrected five-task
selection above passed; the owned documentation test ran directly and passed.
An initial scope declaration omitted the workflow's conservatively inferred
`documentation-deployment` boundary; the declaration was corrected. No production
limit, assertion or test timeout was loosened to get a passing result.

The full unit/CLI aggregate and release seal were not run. Focused development
results do not replace complete candidate qualification. The new test is enrolled
in the existing unit/release selection and evidence shard. Installed source-free
resource acceptance, candidate-bound mandatory seal/recovery receipts, and real
Fastly/client receipts remain 07/09/10. Existing historical 02 timeout evidence
remains historical; this PR neither erases it nor pools it into a release claim.
