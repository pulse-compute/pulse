<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-09
review-by: 2027-04-09
pulse-doc-meta:end -->

# npm publishing

Pulse publishes the exact tarballs produced by `pnpm release:pack`. Publication does not run recursively from workspace directories and does not repack a package after acceptance.

The release path is:

```text
exact v<version> tag
→ operation=qualify: dependency-complete build and acceptance
→ .pulse-release tarballs
→ sealed .pulse-publication bundle
→ operation=publish with qualification_run_id
→ blocking read-only name audit and publication plan
→ protected human approval
→ npm trusted publishing
→ registry integrity and configured dist-tag verification
→ clean published-CLI and context-app smoke tests
```

The machine-readable publication contract is the `publication` object in `release/pulse-release-manifest.json`. The production workflow is `.github/workflows/npm-publish.yml`.

## Prepare release identity

Run **Release preparation** from `main` with the next version (without `v`).
It starts from `latest`, reconciles `main`, applies the explicit documentation
history choice, prepares the version metadata, validates
the result, and opens a draft release PR into `main`.

```bash
gh workflow run release-prepare.yml --ref main -f version="$NEXT_VERSION" -f documentation_history=archive-current
```

Set `NEXT_VERSION` to the release you intend to prepare and write its notes in
`CHANGELOG.md` under `Unreleased` first. Preparation moves those notes into the
new version section and preserves published changelog history. Existing
archives are compared with the tagged source and never silently overwritten.

The default `archive-current` rebuilds the previous documentation snapshot from
its exact tag. For the reviewed npm-published release whose hosted docs are not
a recovery target, deliberately select `documentation_history=replace-unpublished-docs`.
That choice skips snapshot construction and checks the preserved tag commit
against `readiness.versionPreparation.unpublishedDocumentationReleases` in the
release manifest. Unlisted versions fail closed. It removes only the old current
entry from the next hosted docs list; npm artifacts, Git tags, and published
changelog sections remain intact. The draft PR records the choice and evidence.

Preparation runs with read-only repository permissions. A separate job pushes
the prepared Git bundle to a new branch and creates a draft PR; it does not
execute the prepared source with its write token. The repository must allow
GitHub Actions to create pull requests. No additional credential is required.
If PR creation is disabled, the job reports the prepared branch for manual PR
creation rather than changing repository settings.

Mark the draft **ready for review** to trigger the ordinary PR checks. GitHub
does not trigger those workflows for PR creation using `GITHUB_TOKEN`; the
human ready-for-review event starts them without another credential. Existing
checks include release preparation inside `Repository validation / maintenance`:
publishable code changes into `main` require a newer, synchronized version,
archived previous documentation (or its reviewed unpublished-docs exception),
and a changelog section. Documentation and
workflow-only changes can retain the version. The check is preparation evidence,
not a release seal or permission to publish.

For a preparation PR targeting `latest`, merge the reviewed changes there and
then manually merge the release into `main`. The tagging helper works only once
HEAD matches the current remote `main` commit and the checkout is clean:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
npm run release:tag -- 1.0.0-beta.7
npm run release:tag -- 1.0.0-beta.7 --write
```

The first invocation checks and prints the plan. `--write` creates an annotated
local `v1.0.0-beta.7` tag and prints the exact push and workflow commands for the
release owner. It never pushes, dispatches publication, claims a seal, or replaces
an existing tag. A matching tag is idempotent; conflicting commits, lightweight
tags and differing local/remote tag objects fail closed. Run those printed
commands only after review. The qualification operation seals the final tagged
commit once and retains its accepted bundle for publication.

After review and merge, the release owner tags the final `main` commit and runs
**npm publication** from that tag with `operation=qualify`. It runs
`release:seal --require-fastly`, copies the accepted package bytes and uploads
the exact publication bundle. Once qualification succeeds, use its run ID for
`operation=publish`. A read-only audit of that bundle must pass before protected
publishing approval becomes available. Audit and publication never build, pack
or seal. A local seal remains development evidence. Reconcile `main` back into
`latest` after release so development starts from the new version.

## Pre-main qualification (REL8-01)

Ready release PRs into `main` now run **Release qualification / qualification**.
The credential-free workflow checks the exact PR merge commit and its base/head
parents, release version, package catalog, documentation archive and changelog
before installing tools. It checks the live PR and `main` at both ends. A changed
head, base or merge candidate requires a fresh run. Drafts do not qualify; a
same-version documentation/workflow PR returns an explicit non-release result
without running the expensive seal. Product changes without a new version fail.

The controller runs one fresh `source-checks` stage after dependency setup and
before compilation: maintainer and publication controls, package/catalog and
source documentation validation, generated snippets/references and the site.
Packing verifies this attempt's pinned result against the same clean source,
Node and dependency bytes. Standalone packing still performs its own validation.
Build, audit/license refresh, workspace tests, all release tasks, installed
feature gates, required Fastly reality and cleanup retain their coverage.

Successful release qualification uploads
`pulse-pr-release-qualification-<run-id>-<attempt>` for 30 days. It contains the
accepted publication bundle, original seal report and `qualification.json` with
PR/base/head/merge/tree identity, run/attempt, bundle and seal hashes, the full
qualification-context digest, and separate feature-gate status. The full seal
and recovery evidence is retained in the matching evidence artifact. Qualification
is not permission to publish and does not waive dedicated K4 evidence or review.

The binding contract supports a reviewed merge commit or a single squash commit
whose first parent is the qualified base and whose tree is the qualified merge
tree. A two-parent merge also requires the qualified PR head as its second parent.
The merged PR and tag must identify that exact commit. The original source in
reports and bundles stays unchanged; a consumer records a separate merge binding.
A different base, tree, head or tag fails even when some file contents match.
Multi-commit rebase chains and merge queues are outside this contract.

**Rollout boundary:** REL8-01 produces the PR qualification and tests its merge
binding. The current tagged publication resolver still accepts only its existing
manual `qualify` artifacts; do not pass a PR run ID to it. REL8-02 implements
verified consumption and retires the post-main qualification step. The tagged
commands above/below remain the operational publication path until that change
lands. Capturing and consuming a prebuilt docs candidate is also REL8-02 work.

The release owner must add the new check to the `main` ruleset and require the
branch to be up to date before merging. A base push after the last live-source
check must invalidate merge eligibility. No settings are changed by this patch.
If an existing PR is retargeted to `main`, reopen or synchronize it to start this
PR-only workflow; editing a title/body does not repeat a long qualification.

## Release handoff record

Copy this compact record for each exact tag. Fill the status and evidence link
for every row; use `pending`, `passed`, `failed`, or `blocked`. Record the
tested commit and terminal report, not merely a dispatched run. Keep a failed
attempt visible when retrying. `promote_latest=false` deliberately stops after
immutable verification; the npm gate and alias steps remain `blocked` until a
separate, approved promotion run.

```text
Tag: v<version>    Tag commit: <40-character SHA>    Release PR: <URL>
Step                  Status     Evidence / run, report, or blocker
PR checks             ____       <full main PR checks at merge SHA>
Release seal          ____       <qualify run ID / terminal seal report>
npm publish           ____       <protected publish run / exact package receipts>
Docs candidate        ____       <tagged docs candidate / manifest digest>
Immutable upload      ____       <deploy + verify-storage reports / object count>
npm gate              ____       <registry-catalog verification / package count>
Alias promotion       ____       <root/latest deployment + storage verification>
Public verification   ____       <Fastly route report / exact and moving URLs>
Last failure: <step, code, object key or none, mismatch class, run attempt>
Human release owner: <name>    Next action: <one concrete action>
```

After the human has reviewed and pushed the annotated tag, select that **tag**
as the workflow dispatch ref and supply the identical `release_tag` input:

```bash
RELEASE_TAG=v<version>
gh workflow run npm-publish.yml --ref "$RELEASE_TAG" -f release_tag="$RELEASE_TAG" -f operation=qualify
# After qualification succeeds, copy its run ID from the Actions run URL:
QUALIFICATION_RUN_ID=<successful-qualify-run-id>
gh workflow run npm-publish.yml --ref "$RELEASE_TAG" -f release_tag="$RELEASE_TAG" -f operation=publish -f qualification_run_id="$QUALIFICATION_RUN_ID" -f run_smoke=true
```

Publication checks that the selected run and its candidate job completed
successfully in this repository's publication workflow, on the same tag and
commit. It downloads the accepted artifact from that run's successful attempt
by immutable artifact ID and verifies its package hashes and source identity.
Missing, expired, failed, foreign-source and old-attempt candidates fail before
protected approval. A moved tag requires new qualification.

Review the terminal seal, dedicated KV/CAS evidence/disposition and audit/plan
before approving `npm-publish`. The audit report is retained per publication
attempt, including failures. Its manifest digest binds publication to the
reviewed bundle; publication rechecks live registry state before uploading.
A missing name or integrity/dist-tag conflict blocks approval. Owner-reviewed
trusted-publisher and protected-environment setup remains a prerequisite.

Qualification uses Ubuntu 24.04, two isolated workers, one compiler slot and a
6,144 MiB admission budget. Its work deadline is 90 minutes, with additional
step/job time for supervised cleanup and evidence upload. This budget permits
completion; it is not a performance improvement. Same-checkout recovery rules
remain unchanged. Fastly CLI 16.1.0 is checksum-pinned and its real local Compute
lifecycle is mandatory. Accepted package checkpoints and artifact hashes are
verified before copying bytes; there is no post-acceptance rebuild or repack.

The accepted bundle is retained for 30 days. `operation=audit` takes the same
`qualification_run_id` for informational package-name/conflict checks and never
starts protected publishing. Every new audit or publish dispatch can reuse the
same successful qualification. Retry failed publication jobs in the same run,
or dispatch publish again with that qualification run ID. Already-published
packages are skipped only when their registry integrity matches. If the bundle
has expired or been deleted, qualification must run again; partial failure
reports cannot substitute for a completed bundle.

Documentation can be uploaded and verified without promotion while npm awaits
approval. After npm verification and human deployment approval, promote from
the same tag:

```bash
RELEASE_TAG=v<version>
gh workflow run documentation-deploy.yml --ref "$RELEASE_TAG" -f release_tag="$RELEASE_TAG" -f promote_latest=false
# After npm verification and review:
gh workflow run documentation-deploy.yml --ref "$RELEASE_TAG" -f release_tag="$RELEASE_TAG" -f promote_latest=true
```

The tagged workflow's candidate job has no production credentials; its protected
publish/deploy jobs still require human approval. An immutable documentation
failure never authorizes replacing an existing key. Inspect
`documentation-immutable-deployment.json` (or the corresponding verification
report) for `failure.code`, `failure.objectKey`, and `failure.mismatch` before
choosing a remedy. `bytes`, `content-type`, and `cache-control` distinguish
the conflict classes. If failure occurs before an object is selected,
`objectKey` is `null`. Failed reports are retained by the workflow's evidence
upload on tags that contain this reporting change. Do not combine artifacts
from different tags or run attempts into one passing record.

For local preparation, the underlying command remains available:

```bash
node scripts/release-prepare.cjs "$NEXT_VERSION" --channel beta --archive-current
```

`--archive-current` requires the committed immutable documentation snapshot.
Use `--replace-unpublished` only when replacing a candidate that has not shipped.
For the reviewed hosted-docs exception, use `--replace-unpublished-docs` instead:
the old release shipped on npm and its changelog must be preserved. See
[documentation versioning](documentation-versioning.md#unpublished-hosted-docs-after-npm-publication)
for exact-link behavior and the audit evidence.
The command updates catalogued metadata and current documentation, runs named
generators, rejects newly changed paths outside its allowlist, and writes an
ignored stale-version-token report. Neither preparation route creates or moves
tags, publishes packages, or deploys documentation. If a tag was created before
the version bump, prepare and merge the metadata first; the release owner must
then correct the unpublished tag before starting publication.

## Authority and trigger

The workflow is manually dispatched **from the exact release tag**, and the `release_tag` input must name that same tag. Qualification, publication tooling, GitHub's native source identity, and npm provenance therefore all refer to one commit. A branch-dispatched run is rejected. The candidate job has no publication authority. The `publish` job is attached to the protected `npm-publish` environment and is the only job granted `id-token: write`.

For example:

```bash
gh workflow run npm-publish.yml \
  --ref v1.0.0-beta.7 \
  -f release_tag=v1.0.0-beta.7 \
  -f operation=publish -f qualification_run_id="$QUALIFICATION_RUN_ID" -f run_smoke=true
```

Set `QUALIFICATION_RUN_ID` to the successful qualification run for this tag.
Complete external package settings before dispatch. Publication performs the
blocking audit before protected approval; a separate audit dispatch is optional.

A human release authority must approve that environment. Codex may inspect failures and prepare bounded patches, but it may not dispatch the release, approve the environment, publish a package, change a dist-tag, or rotate registry credentials.

## Trusted publishing

Pulse uses npm trusted publishing through GitHub Actions OIDC. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` is provided. Published packages support `^22.14.0 || ^24.0.0`; local development supports pnpm `^12.4.2`. Release packing, CI, and the portable dependency bundle select the exact pnpm version in the release manifest (currently 12.4.2). The development range is a compatibility range, not a patch pin; release validators require the exact version to satisfy it. To install the release toolchain and workspace dependencies without lifecycle scripts:

```bash
node scripts/pnpm-toolchain.cjs --install
node scripts/pnpm-toolchain.cjs -- install --frozen-lockfile --ignore-scripts
```

Version 12 of pnpm supplies a native executable. The bootstrap installs the exact npm distribution with lifecycle scripts disabled, verifies its native executable version, and carries that executable in `.validation-tools/pnpm/bin`. Bundle creation verifies the lockfile against registry supply-chain policies and records `lockfileVerification` with its SHA-256. Offline restore first validates that hash and the exact toolchain/platform, then uses pnpm’s `trust-lockfile` mode for the already-verified lockfile; package integrity checks remain enabled. This avoids requiring uncached registry/provenance metadata offline. Normal online installs and CI keep full verification enabled. Release commands use the bundled runner directly. Rebuild dependency bundles when changing the manifest pin; restore rejects a stale toolchain before replacing dependencies. Older release-tag documentation rebuilds retain their original pnpm version.

Local release seals accept Node `^24.0.0` and record the exact patch used. The protected publication workflow remains reproducibly pinned to Node 24.18.0 and npm 11.15.0, and `scripts/release-publication.cjs` rejects a different Node patch, a different npm version, or known long-lived npm credential variables in that job.

Every manifest-owned npm package setting must authorize exactly:

```text
provider:   GitHub Actions
owner:      pulse-compute
repository: pulse-compute/pulse
workflow:   npm-publish.yml
environment: npm-publish
```

In npm's form, enter organization/user `pulse-compute`, repository `pulse`,
workflow filename `npm-publish.yml` (without `.github/workflows/`), and
environment `npm-publish`. Explicitly allow direct `npm publish` in **Allowed
actions**. Current new configurations allow staging by default; staging alone
does not authorize this direct-publication workflow. Separate dist-tag management
permission is not needed for `npm publish --tag latest`. Confirm every existing
publisher's identity and direct-publication permission; preserve valid settings
instead of recreating them. See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).

The repository owner must also confirm the actual GitHub `npm-publish`
environment: tag-only deployment rules, a human release-authority reviewer,
and no long-lived npm publish credential. Inspect rules of type **Tag**;
"Protected branches only" is not a release-tag restriction. Record the selected
tag pattern and reviewer, including the existing self-review/bypass choices,
without inferring those settings from the checked-in workflow. Revoke/remove
temporary bootstrap credentials after setup; preserve human account recovery
and 2FA access. Registry name audits do not inspect these private settings.

Retain a dated owner-reviewed settings receipt for the manifest's complete
package set and environment. Saving a trusted publisher is setup evidence,
not successful OIDC publication: the later protected exact-tag job supplies
that proof. Do not publish a throwaway version just to test setup. The
release record keeps settings review separate from publication receipts.

The workflow publishes public packages directly under the dist-tag in the
release manifest, now explicitly `latest` for future releases. The release
channel and prerelease version remain Beta; the npm tag determines what an
unqualified `npm install` selects. Release preparation preserves this tag
policy across version bumps. An explicitly configured channel tag remains
supported for a release intended for a separate preview stream.

The pinned npm CLI's trusted publishing does not support a separate
post-publication `npm dist-tag` update. Each successful `npm publish --tag latest`
therefore advances that package's default version as part of publication;
the historical `beta` alias is not also advanced. The package set is published
in dependency order, with the public CLI last, and promotion is not atomic
across packages. The protected script verifies the native GitHub tag ref
and SHA against the sealed candidate before the first publish.

This policy applies to future candidate source. Finish an already-started
release using its original tag, tooling, and sealed tarballs. Do not move that
tag or rebuild the same published version to adopt a new publication policy.

## One-time package bootstrap

An npm trusted publisher can be configured only after the package name exists under the intended owner. Before enabling production publication, run:

```bash
npm run release:audit-npm
```

The command derives every package name from the release manifest and writes a timestamped, manifest-digest-bound report to `.pulse-release-preflight/npm-catalog-audit.json`. That report is ignored source evidence: it never rewrites the canonical preflight policy and it performs no registry mutation. Every name must exist with the inert `0.0.0` version and `bootstrap` tag. The `latest` tag may be absent, point to that placeholder, or point to a version both present in the registry and listed in `release/documentation-versions.json` or in the release manifest’s reviewed `unpublishedDocumentationReleases` decisions. This preserves existing releases during the next bootstrap audit. Missing versions and unknown release targets remain blocking; any remediation is an explicit human registry action.

Any missing package name requires a one-time human, 2FA-protected bootstrap publication through `scripts/npm_bootstrap.sh <package-name>`. After all names exist:

1. configure the trusted publisher on every package;
2. select the exact release tag as the manual workflow ref;
3. confirm OIDC publication succeeds;
4. remove any temporary bootstrap credential; and
5. prohibit ordinary publish tokens for routine releases.

The production workflow fails rather than silently performing first publication with a broader credential.

### MCP package handoff

`@pulse-compute/mcp` joins the twenty-package `1.0.0-beta.7` candidate. The
2026-10-07 registry check returned E404 for this name. Existing-package-name
policy remains enabled; prepare its inert placeholder without registry mutation:

```bash
scripts/npm_bootstrap.sh --prepare-only @pulse-compute/mcp .pulse-release-preflight/mcp-bootstrap
```

The destination must not exist. Inspect the resulting `0.0.0` tarball: only
`package.json`, `README.md`, the root `LICENSE` and `NOTICE` are allowed. It has
no exports, executable entry points, scripts or dependencies, and declares the
`bootstrap` tag. The real adapter is a separate synchronized release artifact.

The human release owner then runs `scripts/npm_bootstrap.sh @pulse-compute/mcp`
with the one-time 2FA credential, reruns `npm run release:audit-npm`, and configures
this package's trusted publisher for GitHub owner `pulse-compute`, repository
`pulse`, workflow `npm-publish.yml`, environment `npm-publish`. Remove the
bootstrap credential after setup. Keep first publication blocked until that
handoff and the final tagged-source release qualification complete; package
membership and local acceptance do not establish registry readiness.


The single `mcp-installed` release-feature gate qualifies the exact CLI-shipped
context app using the standard candidate tarballs, production Node composition,
official client 2.2.0 and Codex 0.160.1. It records source/tree and oracle hashes,
installed package tarball/file hashes, extracted app files, build/catalog/schema/
corpus identities, terminal cleanup, startup time, response sizes and elapsed
commands. A starter supplied through MCP is tested/built locally by the acceptance
client. Scope/write-path negatives remain in the focused `mcp-authorization`
fixture. Do not add this installed gate to fast PR or aggregate release profiles,
or require a full seal for each PMCP ticket.

After publication/registry integrity verification, the workflow runs the existing
narrow context smoke using the selected release manifest version. It is required
even when `run_smoke=false` skips the separate CLI journey; a normal beta.7
release selects `run_smoke=true` to execute both. For a manual replay, use the
checkout for the exact published release:

```bash
node wasm/test/mcp/smoke-context-registry.cjs 1.0.0-beta.7
```

This smoke installs the exact published CLI into a fresh temporary directory,
copies its bundled context example, installs exact dependencies with lifecycle
scripts disabled, builds/prepares the app and starts its production host. It
checks discovery, five-tool listing, a starter response's version/corpus identity
and graceful shutdown. It retains registry URLs/integrities, package/build/corpus
identities, cleanup, startup/response/elapsed measurements in
`wasm/.test-results/context-registry-smoke.json`. It does not repack, publish, deploy
or replace final release qualification. Missing versions fail; no candidate or
floating-version fallback is used.

The verification job requires a terminal passing report for the selected version
and passing cleanup. It retains the context report with registry and CLI reports
on success or failure. A failed smoke, missing report or failed cleanup leaves
verification incomplete. Retry verification in the same publication run against
the original bundle; no new candidate seal is required.

Carry these statuses separately in the release handoff:

| Step | Owner / evidence |
| --- | --- |
| Packed context journey | `mcp-installed` terminal report for the final immutable candidate |
| MCP name bootstrap | Human owner; inert `0.0.0` plus `bootstrap` tag and registry audit |
| Trusted publisher | Human owner; exact repository/workflow/environment configuration |
| Final tagged release qualification | Release controller's seal and installed-feature reports |
| Exact package publication | Protected publication run and registry integrity verification |
| Published context smoke | Command above, terminal report after publication |

Bootstrap, trusted-publisher setup, publication and the published smoke remain
pending until their actual evidence exists. Local candidate results do not close
those rows. Startup, reply-size and focused-test timings are initial baselines;
no latency threshold is introduced.

## Sealed candidate

After `pnpm release:pack`, prepare the candidate:

```bash
npm run release:candidate
npm run release:verify-bundle
```

`.pulse-publication/pulse-publication-manifest.json` records:

- release version, tag, channel, registry, workflow, and protected environment;
- source commit and ref;
- the exact publication order;
- every tarball path, byte length, SHA-256, and npm SHA-512 integrity;
- Pulse package dependencies used to derive the topological order; and
- checksums for the source catalog and packed-release manifest.

The bundle includes the exact tarballs. GitHub artifact transfer does not create a second npm package payload.

## Dependency-safe, resumable publication

Publication orders internal `dependencies` and `optionalDependencies` before dependants. Peer dependencies are validated by release packing but do not introduce an ordering edge. Stable role/name ordering makes retries deterministic.

For each package:

```text
version absent
  → publish the sealed tarball with --access public --tag <release dist-tag>

version present with identical SHA-512 integrity
  → record already-published and continue

version present with different integrity
  → stop with a critical immutable-version conflict
```

This is resumable after a partially completed synchronized-package release without pretending npm publication is transactional. A same-version integrity mismatch cannot be repaired by overwriting the registry artifact; the human release authority must investigate and choose a new version if necessary.

npm can accept an upload while the version is still being processed. The script
uploads the remaining tarballs in dependency order, with the CLI last, without
waiting for each package's registry visibility. It then polls the pending set
under one shared ten-minute deadline for both sealed integrity and configured
tag. Each round reads pending packages in order and pauses once, with intervals
capped at 30 seconds; ready packages leave the polling set. Registry processing
can overlap even though uploads and registry reads remain sequential.

Progress goes to stderr and identifies each package, attempt, elapsed time, and
whether the version or tag is still pending. An observed integrity conflict
stops immediately. A timeout reports the unresolved packages. Upload order is
not a registry visibility guarantee: dependants may become visible before their
dependencies, and the release remains incomplete until full verification passes.

If processing exceeds the deadline, wait for registry visibility and use
**Re-run failed jobs** on the same workflow run. Keep the release tag and sealed
candidate unchanged: matching published packages are skipped, and publication
continues with the remaining packages. No new seal is required for that retry.
If source changes and a tag is moved before any publication, start a new workflow
dispatch instead; GitHub reruns retain the original event's commit SHA.

## Verification

The protected publish job waits for the uploaded set and verifies the complete release. A separate unprivileged job then confirms:

- every manifest-owned `name@version` record exists;
- registry `dist.integrity` equals the sealed tarball integrity;
- the configured dist-tag points to the release version;
- with `run_smoke=true`, the published canonical CLI installs in a clean prefix and completes version, init, install, doctor, test, and Node build smoke checks; and
- the exact published CLI's bundled context example builds and starts, discovers
  its five tools, returns matching starter metadata and shuts down cleanly.

The registry report uses schema `pulse.npm-publication-verification.v1`. The documentation deployment accepts that schema as evidence that matching packages are publicly available before it promotes root and `latest`.

## Local commands

These commands do not publish unless the explicit `publish` command is used from the protected GitHub environment:

```bash
pnpm release:pack
npm run release:candidate
npm run release:verify-bundle
npm run publication:check
```

Actual publication remains a human-approved workflow action, not a normal local maintenance command. The CLI does not expose a non-GitHub publication bypass; production publication requires the trusted GitHub/OIDC environment. The release validator exercises planning and failure behavior with in-process registry fixtures and never invokes `npm publish`.
