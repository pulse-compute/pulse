# RC-H03 — installed candidate qualification

The release owner requested RC-H03: qualify clean installed consumers and
reconcile the supported package/target claims against exact packed bytes.
This is a development checkpoint toward RC1, not the RC-H05 release seal.

## Qualified snapshot

- Integrated base: `ea60368a3add774b6672edb115f9457be5a0b1a3` (RC-H02 merged).
- Clean tested source: `b716082b9fdb414d47df36961020a1e43dbf0f67`.
- Tested tree: `e97fc8747fed3df74e7b05f354795244d07cdcd0`.
- Toolchain: Node 24.18.0, npm 11.15.0, pnpm 12.4.2.
- One source-bound shared pack supplies all 20 Pulse tarballs. Each consumer
  receives verified copies; installed checks compare package bytes with the
  archives, and a missing Pulse candidate cannot fall through to the registry.
- Versions remain the inherited `1.0.0-beta.11` development metadata. These
  receipts do not identify newly published beta.11 packages or authorize
  replacing immutable registry artifacts.

`packed-claims.json` records the 20 package identities, tiers, exact tarball
hashes and all 34 declared supported entry points present in the packed files.
Export presence is static closure evidence; execution is qualified by the
separate workflows below. Internal exports are not promoted to public APIs.
`evidence.json` binds terminal reports, oracle/log hashes and retained attempts.

## Results

| Gate | Result and boundary |
| --- | --- |
| Release packages | Twenty package manifests, legal files, synchronized versions, dependency closure, installed documentation and supported-entry policy pass |
| Clean-machine acceptance | Node Native/JavaScript and Fastly Native/JavaScript install/init/doctor/inspect/test/dev/compile/build workflows, plus shipped examples pass |
| Installed corpora | S3 reads/writes, shared request deadline, multifile compilation, HTTP input outcomes, bounded read loops, read-loop adoption and conditional KV pass |
| Installed features | All twelve controller-required gates pass, with complete terminal coverage and identical package hashes across reports |
| DELETE/OPTIONS | Six real local HTTP cases and three pre-dispatch denials pass using the same full package installation; all installed Pulse bytes remain unchanged |
| Packed claims | All declared supported exports/binary targets exist in the exact tarballs; package/target limits below remain explicit |

The feature gate identities and per-task outcomes are in `evidence.json`.
Conditional-KV fixtures are not the local K4 or deployed cross-location proof.
Fastly emitted-Wasm ABI fixtures are not Viceroy or deployed Fastly evidence.
Generated output remains experimental even though its installed gate passes.

## Claim reconciliation

The acceptance guide and installed mirror now identify all 20 artifacts and
12 feature gates, include MCP and the terminal host-extension gate, include
S3 `getBody`, and explain the Node provider's supported `/server` and
`/toolchain` exceptions inside an implementation-tier package. The testing
guide's stale numeric cross-reference is also removed.

- Node and Fastly retain explicit Native/JavaScript selection; compile-only
  remains a separate non-executing target. No automatic fallback is enabled.
- S3 supports `head`, `getText`, `getBody` and `putText` only on Node Native,
  Node JavaScript and Fastly Native; Fastly JavaScript remains ineligible.
- MCP's static Pulse binding does not gain Fastly JavaScript eligibility.
- The production Node launcher remains finite HTTP; forwarding, generated
  output, transforms, S3-body/blob production qualification remain separate.
- Upload/list/delete package operations, OpenAPI export and new deadline
  controls are not added by these results.

The tested snapshot contains the acceptance-guide corrections. A later
documentation/evidence commit adds these receipts and removes the stale gate count
from the testing guide and its installed mirror. Receipts continue to identify
the tested snapshot and tarballs; they are not rewritten to claim acceptance
of a different source or archive. The subsequent documentation-only correction
is checked by documentation validation, not a repeated behavioral campaign.

## Attempts and reproduction

The first core/feature launch stopped because a relative runner report path
created untracked files under `wasm/wasm/`. The clean-source guard rejected that
checkout before consumer acceptance. The raw [core](./launch-core-failed.log) and [feature](./launch-features-failed.log)
launch logs are retained;
move the misplaced reports out of the checkout and use an absolute report
path. The retry uses the same unchanged clean snapshot and verified package
set. No assertion, source-cleanliness rule or gate selection was relaxed.

From that clean tested snapshot, with the pinned toolchain on PATH:

```sh
node scripts/pnpm-toolchain.cjs -- run build
node scripts/release-shared-pack.cjs --out .pulse-release/rc-h03-shared
```

Supply the environment returned by
`require('./scripts/release-shared-pack.cjs').sharedPackEnv('.pulse-release/rc-h03-shared')`
to both registered acceptance invocations:

```sh
node wasm/scripts/run-wasm-tests.cjs --task release-packages --task clean-machine-acceptance --report /absolute/path/rc-h03-core.json
node scripts/release-feature-acceptance.cjs
```

The additional DELETE/OPTIONS proof uses the existing
`wasm/test/api/fetch-method-installed-http.cjs` copied into an isolated install
of all 20 exact tarballs. The existing `verifyClosure` from
`wasm/test/release/assert-request-deadline-packages.cjs` checks the full installed
file inventory before and after that child. NODE_PATH/NODE_OPTIONS are removed;
the child verifies its loaded Pulse modules come from the installed runtime.

## Remaining gates

RC-H04 owns candidate-specific provider reality, dedicated K4 requirements,
live origin evidence and any explicit owner dispositions. RC-H05 selects the
release identity, freezes the final source and runs the aggregate release and
installed gates again. This pass does not create a release checkpoint that
can be resumed across source changes, and does not merge, publish or deploy.
