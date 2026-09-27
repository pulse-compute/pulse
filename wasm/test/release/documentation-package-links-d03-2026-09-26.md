# D03: published beta.5 documentation links

Read-only registry/tarball audit at 2026-09-27T00:10:27.193402+00:00. Tagged source: `v1.0.0-beta.5` at `91cc3145e7ad4bec5d94c228d95016b0f77d04fd`. Package names come from that tag’s release manifest, not the development package list.

## Scope and result

Fetched the version metadata and tarballs for all 19 tagged packages from `https://registry.npmjs.org`. Every tarball matched both npm’s SHA-512 integrity and SHA-1 shasum. No package was installed or executed. Metadata omitted `gitHead`, so the source-tag identity is recorded separately and is not claimed as a registry provenance verification.

All 19 tarballs contain exact beta.5 documentation URLs. There are 37 distinct literal URLs across decoded UTF-8 files (including anchors); this is a literal inventory, not the set of URLs that code can construct. The CLI’s `package/src/documentation.js` also constructs URLs from its pinned `DOCUMENTATION_VERSION`, and diagnostics use exact-version destinations. No redirect or mutable alias can repair those embedded values safely without changing their semantics.

The CLI tarball includes 75 files under `package/docs/` plus its README, release manifest, and documentation URL helper. The Markdown docs are available offline in the matching installed CLI. References to hosted URLs inside those documents remain exact; offline availability is not a claim that every external link works. Tagged source is also available at https://github.com/pulse-compute/pulse/tree/v1.0.0-beta.5/docs.

## Deliberate behavior

The next release preparation can omit the beta.5 hosted archive while preserving the beta.5 Git tag, npm tarballs, published changelog, and release-preflight recognition. Beta.5 is omitted from the next hosted selector. Its embedded exact links remain unchanged: no redirect to newer contracts, compatibility tree, recovery upload, or bucket deletion is introduced. Missing storage objects remain not-found; any existing objects remain untouched. This audit does not establish current HTTP/storage absence. D01 records only that the production dispatch failed before the beta.5 exact tree.

## Verified package identities

All rows are version `1.0.0-beta.5`. Registry metadata is `https://registry.npmjs.org/<encoded-name>/1.0.0-beta.5`; tarball URLs are npm-owned `dist.tarball` results. SHA-256 below identifies the downloaded bytes after the npm integrity checks.

| Package | Unique literal exact URLs | Tarball SHA-256 |
| --- | ---: | --- |
| `@pulse-compute/runtime` | 17 | `ace5366f421bf5d3c2c723e76a7110eabe6d58a227c3abb85b3dd17772e7c186` |
| `@pulse-compute/pulse` | 1 | `912f7f1b897b94a3980fc59e458908adb5801d4d2294c40c9770f6195a2e50ec` |
| `@pulse-compute/cli` | 5 | `10d49e4d4c62eff7f1ce749db3d5fe0a558b0331eb3b21d68d7c12393a95d883` |
| `@pulse-compute/provider-fastly` | 4 | `8735aadfd093e271cee526e6c2f08edb759d15af865b1ec74772ab896b890d3e` |
| `@pulse-compute/grip` | 2 | `cb18e01392aec610547dbca6fcfcda45702451e1b8feaa31dbbb9e7189ace950` |
| `@pulse-compute/assets` | 2 | `69e1f95ffd54a277b62deb869c6e4b05e68db3a5eb9a4d06f1e21503bf675f73` |
| `@pulse-compute/crypto` | 2 | `daab1e13eeaf4f17965943b77cc9b530bcea3e03ce1889e2511874a25a8691b3` |
| `@pulse-compute/jwt` | 1 | `91a0c209226ef9e260dcd8fa1e6f41c0da3ab01af991249f4f55bce5fa5148c3` |
| `@pulse-compute/entities` | 2 | `82782d6b8a33386e76f8c2c4161a334719f91b00e830c4ef1f514c2e849ac482` |
| `@pulse-compute/s3` | 1 | `ea0d20614f759a2c053378ed07ba71af7dd69169b86f02029a956d76266a48a2` |
| `@pulse-compute/wasm-build-support` | 1 | `daef675d1426b546e2ee9b7b43860e8409858792eb5df785d3cd55c854a102fc` |
| `@pulse-compute/wasm-compiler` | 2 | `eb487eff2eae7bc444ab2efdd234065c3d50af045845bb755298a0041cc72c95` |
| `@pulse-compute/wasm-guest-link` | 1 | `c932405d9ce63bb345a2f4b4158e639381de0064627087b7a3820e5b0d95707c` |
| `@pulse-compute/wasm-contracts` | 1 | `8c176bab9149ef0c91e5c84d3a1b08ce2a1031e458bf24f7d4bc8a0e4785ae4a` |
| `@pulse-compute/wasm-host-runtime` | 1 | `8cb5528a70680745d7ec0f651e80e523c92c0c94c8168f2d94a971966345eb45` |
| `@pulse-compute/wasm-library-kit` | 1 | `0ee10a1a086dde919b221067c7496ddf3ab740095a9dd70bc2c4b0c6229dd55e` |
| `@pulse-compute/provider-node` | 2 | `4a1c5cf940de8249684195b4330209343afde4b5c96daca02acea3ea53ee474a` |
| `@pulse-compute/wasm-runtime-core-as` | 2 | `73e6650ad024694ff2dc67d4690b547b4d30d89f55182bbfe18744bca5a9aebd` |
| `@pulse-compute/wasm-schema-json` | 3 | `a23edbe1dbc802016d2c25f64e3f3cf53b2cf0d2df2cb9c2044ea0fbb6dcc507` |

## Literal URL inventory

All paths below are relative to `https://pulsecompute.io/v1.0.0-beta.5/`. Package homepage metadata also names this exact release.

- `./` — cli
- `architecture/overview/` — wasm-runtime-core-as
- `concepts/compilation-and-lowering/` — wasm-compiler
- `concepts/compilation-and-lowering/#bounded-application-values` — runtime
- `concepts/contracts-and-providers/` — provider-node
- `concepts/entities-and-adapters/` — runtime, entities
- `examples/10-entities-tools/` — runtime
- `examples/11-events/` — runtime
- `guides/compatibility-imports/` — runtime, grip, assets
- `guides/events/` — runtime
- `guides/fastly-capabilities/` — provider-fastly
- `guides/json-schemas/` — wasm-schema-json
- `guides/json-schemas/#decode-application-owned-text` — runtime
- `guides/json-schemas/#encode-application-owned-text` — runtime
- `guides/project-lifecycle/` — runtime
- `packages/assets/` — assets
- `packages/cli/` — cli
- `packages/crypto/` — crypto
- `packages/crypto/#exact-text-digest` — crypto
- `packages/entities/` — runtime, entities
- `packages/grip/` — runtime, grip
- `packages/implementation-packages/` — wasm-build-support, wasm-compiler, wasm-guest-link, wasm-contracts, wasm-host-runtime, wasm-library-kit, provider-node, wasm-runtime-core-as, wasm-schema-json
- `packages/jwt/` — jwt
- `packages/provider-fastly/` — provider-fastly
- `packages/pulse/` — pulse
- `packages/runtime/` — runtime
- `packages/runtime/#wall-time` — runtime
- `packages/s3/` — s3
- `reference/cli/` — runtime
- `reference/compatibility-matrix/` — runtime
- `reference/diagnostics/` — runtime, cli
- `reference/diagnostics/#pulse-build-out-unsafe` — cli
- `reference/diagnostics/#pulse-schema-decode` — cli
- `reference/environment/#pulse-fastly-bin` — provider-fastly
- `reference/handler-authoring/` — runtime
- `reference/project-config/#fastly-provider-options` — provider-fastly
- `reference/project-config/#json-schema-policy` — wasm-schema-json


## Local beta.6 preparation rehearsal

The checked-in release stays at beta.5. On implementation source `a6d18a7`, a
fresh isolated checkout ran `node scripts/release-prepare.cjs 1.0.0-beta.6
--channel beta --replace-unpublished-docs`. It prepared 19 package versions,
54 exact dependency updates, and synchronized metadata/docs without creating a
beta.5 archive. The four existing archive trees and release-evidence files were
byte-identical before/after. The beta.5 tag still resolves to
`91cc3145e7ad4bec5d94c228d95016b0f77d04fd`.

Local candidate commit `8795acfe37308583bc7a73a5ee05385d28c41dd2` passed:

- release PR identity checks against actual `main` (`91cc3145…`);
- maintenance, publication-control-plane, and release-preflight validation;
- docs synchronization, site/link checks, and `documentation-release.cjs`;
- read-only npm catalog audit: 19 existing names, 19 bootstrap-compliant, no
  remediation, all `latest` tags still at beta.5 despite beta.5 being absent
  from the proposed hosted version list;
- generated docs candidate seal and verification: 600 sealed objects, 193
  selected for current-version/mutable production operations, no beta.5 tree.

The prospective manifest identifies `v1.0.0-beta.6`; its source identity remains
an honest local branch ref. No beta.6 tag was created, no package was packed or
published, and no storage operation or alias promotion occurred. These checks
are development/preparation evidence, not the final release seal.

The full `release-prepare-pr.cjs` rehearsal stopped earlier, when its mandatory
merge of `main` into `latest` produced 79 existing conflicts. That merge was
aborted; the successful direct preparation above does not establish mergeability.
The release owner must reconcile those branches before dispatching the full
workflow. Publication and documentation-deployment stage gates remain blocked
by the existing external/release evidence requirements; the read-only npm audit
does not waive them.
