<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-16
review-by: 2027-01-16
pulse-doc-meta:end -->

# Release packages and clean-consumer acceptance

The current Beta candidate contains nineteen publishable packages
synchronized at version `1.0.0-beta.2`. The product-facing packages are:

```text
@pulse-compute/pulse
@pulse-compute/runtime
@pulse-compute/cli
@pulse-compute/provider-fastly
@pulse-compute/grip
@pulse-compute/assets
@pulse-compute/crypto
@pulse-compute/jwt
@pulse-compute/entities
@pulse-compute/s3
```

The CLI and providers depend on additional `@pulse-compute/wasm-*`
implementation packages. Those packages are installable transitive
dependencies, not the handler authoring surface. The generated
[package support policy](../packages/README.md) defines the tier, audience,
direct-install guidance, and supported entry points for all 19 artifacts.

## S3 candidate acceptance

The S3 package root supports bounded `head`, `getText` and `putText` on Node
Native, Node JavaScript and Fastly Native. The clean-consumer gate repeats the
same read and write failure corpus using installed package exports, packaged
lowering and provider builds. It type-checks the public declarations and
compares every installed Pulse package file against its exact tarball both
before and after execution. No workspace links or installed dependency edits
are permitted. The report `s3-packed-acceptance.json` includes all tarball
SHA-256 identities and target execution counts in the acceptance task directory.

Fastly's host ABI fixture supplies the platform to compiled Wasm; no workspace
product implementation is loaded by the packed consumer. Fastly JavaScript S3
remains ineligible for its documented raw-header limitation. Local acceptance
does not claim live Object Storage behavior. That separate evidence follows
infrastructure setup (T2); package promotion does not publish npm artifacts or
change the existing registry bootstrap and release approval gates.

## Conditional KV acceptance

Conditional KV has additional required acceptance beyond the aggregate release
profile and the generic Fastly Compute reality task:

- `node wasm/scripts/run-wasm-tests.cjs --task kv-conditional-acceptance --no-report`
  installs exact candidate tarballs and executes the Native consumer through
  Fastly CLI/Viceroy. An unavailable engine or semantic failure fails this gate.
- Full deployed Pulse cross-location acceptance uses the reviewed isolated
  environment and probe driver described in the
  [K4 acceptance record](https://github.com/pulse-compute/pulse/blob/latest/wasm/test/kv/K4.md).

The retained Viceroy 0.21.0 run fails missing-key CAS. The standalone deployed
Rust SDK probe confirms rejection for never-created and deleted keys in its
tested cases, but does not satisfy either required Pulse acceptance gate. Full
Pulse deployed cross-location evidence remains pending the isolated environment.

Report these gates separately even when `release:seal -- --require-fastly`
passes: that command does not include the dedicated K4 acceptance task or its
deployed runner. Preserve the local failure and pending deployed requirement as
release-readiness blockers. An explicit human-directed acceptance-policy change
must specify any replacement evidence and update the owning gates and current
contracts; a guidance update alone neither waives a gate nor changes CAS behavior.

## Event experimental candidate

Before changing release identity or package composition, the event surface has
its own evidence-only package and consumer seal:

```bash
node wasm/scripts/run-wasm-tests.cjs --task events-candidate-seal --no-report
```

That task packs `@pulse-compute/pulse`, `@pulse-compute/runtime`, and their
public contract dependency, installs the exact tarballs without network access,
type-checks both application and host-maintainer event consumers, checks legal
and dependency closure, and compares a second pack byte-for-byte. It also emits
the event candidate decision and a blocker ledger under `wasm/.test-results`.

Passing this focused seal means the event-facing package closure is internally
consistent. It does not authorize publication or claim Fastly/browser/ESP32
event support.

## Check documentation release integrity

```bash
pnpm docs:check
node scripts/documentation-release.cjs
```

The documentation checks verify:

- generated documentation/package files and source-bound Markdown blocks are synchronized;
- canonical repository, installed-package, and exact-version hosted links and anchors resolve;
- every package has one generated status block and required repository metadata derived from the release manifest;
- each advertised supported package entry point exists in `exports` or `bin`;
- every public diagnostic has one real anchor and an exact-version docs URL;
- installed help, the public reference, the machine-readable command specification, and three shell completions agree on the public command and option set;
- public project, schema, development, test, and Fastly configuration fields and runtime rules agree with the shared schema and runtime normalization;
- the Fastly provider schema agrees with provider defaults and the compiled package payload;
- recognized environment variables agree with their generated scope reference;
- public plugin claims remain blocked until all six trust, discovery, compatibility, loading, and security prerequisites are implemented;
- contributor and governance pages carry valid owner, status, review, and stale-date metadata;
- the exact-version documentation site contains release banners, local search, and version navigation.

Maintainer-only task and report controls remain available to repository truth suites but are absent from installed help and the public CLI reference.

## Pack a release candidate

From the source workspace:

```bash
pnpm release:pack
```

This builds the workspace and writes nineteen package tarballs plus `pulse-release-manifest.json` under `.pulse-release/`. It prepares release artifacts; it does not publish them to a registry.

Packing fails when:

- a package is private or versions diverge;
- a packed dependency retains `workspace:`;
- repository-only tests or internal documentation leak into a tarball;
- required API/CLI reference files are absent;
- a Markdown link or anchor is dead after extraction;
- a link escapes its package root;
- an exact-version Pulse documentation URL does not map to a real file and anchor in the packed release set.

`@pulse-compute/runtime` ships its canonical API and preview-scope references.
`@pulse-compute/cli` ships the public documentation hierarchy,
API/CLI/config/diagnostic/package references, bounded compatibility material,
and runnable example sources.

## Clean-consumer acceptance

```bash
node wasm/scripts/run-wasm-tests.cjs --task clean-machine-acceptance --no-report
```

The release task creates an isolated npm home and cache, installs exact packed candidates rather than workspace links, and validates:

```text
install
→ pulse init
→ npm install
→ pulse doctor
→ pulse inspect
→ pulse test
→ pulse dev --once
→ pulse build
```

It runs that workflow for new Native and JavaScript Node/Fastly projects,
verifies a real Fastly Native `bin/main.wasm`, and installs/builds the canonical
GRIP and Router examples from the packed package set. The two JavaScript
projects prove packed `inspect`, passing `doctor`, `test`, one-request `dev`,
provider-neutral `compile`, and deterministic `build`. Their executable source
packages contain exact reachable dependencies, no Native planning artifacts,
and `automaticFallback: false`. The Node target satisfies all 12 support gates;
the Fastly target satisfies all six support gates, emits source/deployment
manifests with provider reality and deployment still false, and does not install
the downstream Fastly compiler into an ordinary Pulse consumer.

## Offline deployment candidates

```bash
npm run release:candidates
```

This gate builds the representative Fastly Native and Fastly JavaScript targets
twice from the same output location. Native output, including `bin/main.wasm`,
must be byte-identical. Fastly JavaScript source, deployment metadata, and exact
toolchain closure must be byte-identical; one closure is then compiled by the
pinned `@fastly/js-compute` runtime compiler into `bin/main.wasm`.

The downstream Wizer snapshot is recorded by exact SHA-256 but is not presented
as byte-reproducible. The candidate report distinguishes that toolchain-owned
property from Pulse-owned deterministic input and metadata. It also records zero
provider-reality runs, zero deployments, and zero publications.

The task owns the nineteen publishable Pulse packages, not the packages in the
development installation. It installs every exact Pulse tarball into clean
consumer projects and verifies the installed name, version, and real path. An
ephemeral server bound to `127.0.0.1` is the fail-closed registry for the
`@pulse-compute` scope, so an undeclared or missing Pulse candidate cannot fall
through to a previously published package. Third-party dependencies resolve
from the canonical npm registry according to the packed manifests; the release
gate does not repack or assume ownership of `assemblyscript`, `long`, `esbuild`,
or other external packages. Lockfile and dependency evidence remain separate
workspace inputs.

External Fastly Compute execution is also separate:

```bash
PULSE_FASTLY_BIN=/path/to/fastly \
node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-compute-reality --no-report
```

The task records the Fastly CLI version, invokes `fastly compute serve --file`, and lets the CLI own its local Compute engine. It then sends real HTTP requests through the generated native module. `PULSE_VICEROY_BIN` remains available only as an explicit lower-level reproduction override. The fixture covers schemas, configuration, secrets, KV persistence, named-backend fetch, opaque bytes, repeated headers, and GRIP hold/publish. It does not deploy or activate a Fastly service.

The aggregate candidate seal is:

```bash
npm run release:seal
```

It restores dependencies, validates the repository and generated documentation, runs the complete release profile, and adds the external Fastly task when the Fastly CLI can start its managed local Compute lifecycle. Use `--require-fastly` to make that host proof mandatory.

The seal also regenerates the production vulnerability and installed-platform
license closure. It does not depend on mutable npm trusted-publisher settings,
GitHub publication environments, public repository administration, or the
production documentation origin. Those remain blocking at publication or
documentation deployment, where the corresponding authority is actually used.

With a clean passing seal, create the release evidence delivery:

```bash
npm run release:evidence -- \
  --base <accepted-source-ref> \
  --head HEAD \
  --label <delivery-name> \
  --out <new-output-directory>
```

The evidence authority checks that all reports belong to the exact head
revision, aggregates sixteen passing shards, creates source and binary-patch
artifacts, independently applies the patch to the accepted source archive, and
compares path, mode, and bytes with the sealed head. The resulting bundle is
offline evidence only; merge, tagging, deployment, activation, and publication
remain human-authority operations.

## Publication workflow

After all dependency-bound acceptance passes, seal the exact tarballs:

```bash
npm run release:candidate
npm run release:verify-bundle
npm run publication:check
```

Production publication is performed only by the manually dispatched **npm
publication** workflow at the exact release tag. Its protected `npm-publish` job
uses npm trusted publishing through GitHub OIDC, publishes the tarballs from
`.pulse-publication` in dependency-safe order, accepts an already-published
version only when registry integrity matches, and verifies every configured
dist-tag. A separate job installs the published CLI in a clean prefix and
completes init, install, doctor, test, and build smoke checks.

Before the first trusted publication, every package name must exist and authorize the exact repository, `npm-publish.yml` workflow, and `npm-publish` environment. Use the package-name audit and a one-time human 2FA bootstrap for any missing names. No long-lived npm token is part of the normal workflow.

## Publication hold points

Before publication, confirm the repository, final documentation host/base path, package policy, and issue-tracker values centralized in `release/pulse-release-manifest.json`. Pulse is licensed under Apache-2.0: the release gate requires the exact root `LICENSE`, SPDX metadata in the workspace and all nineteen publishable packages, and the same license text in every npm tarball. A dependency-license audit and its dispositions remain separate release evidence.

A human release authority must approve `npm-publish`. Codex may diagnose or prepare a patch but cannot publish, approve the environment, bootstrap package names, or mutate dist-tags.

## Versioned documentation artifact

The release owns a versioned hosted-documentation gate:

```bash
pnpm docs:site:check
```

The check builds the exact `v1.0.0-beta.2` site and `latest` tree in a temporary directory, creates one search entry per public page, validates local hosted links, verifies release/version manifests, and requires the search, version, owner, and review UI on every page.

The **Documentation** workflow repeats those checks for pull requests and `main`, seals a preview deployment manifest, and uploads artifacts without production credentials. It does not deploy to GitHub Pages.

Production delivery uses the manually dispatched **Documentation deployment** workflow and Fastly Object Storage. The workflow:

```text
build and seal
→ upload/verify v1.0.0-beta.2 and its receipt immutably
→ verify all matching npm packages and configured dist-tags
→ promote root and latest
→ verify representative URLs through Fastly
```

The deployment never deletes bucket objects. A pre-existing immutable key with different SHA-256 fails before promotion. The `documentation-production` environment, Object Storage credentials, VCL service, final public origin, and service activation remain under human release/infrastructure authority.

Release packing also checks the installed CLI command specification,
configuration schema bundle, release/version manifests, shell completions,
current architecture and plugin-readiness records, maintenance policy, and
publication/deployment references.
