<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# npm publishing

Pulse publishes the exact tarballs produced by `pnpm release:pack`. Publication does not run recursively from workspace directories and does not repack a package after acceptance.

The release path is:

```text
exact v<version> tag
→ dependency-complete build and acceptance
→ .pulse-release tarballs
→ sealed .pulse-publication bundle
→ protected human approval
→ npm trusted publishing
→ registry integrity and configured dist-tag verification
→ clean published-CLI smoke test
```

The machine-readable publication contract is the `publication` object in `release/pulse-release-manifest.json`. The production workflow is `.github/workflows/npm-publish.yml`.

## Prepare release identity

Run **Release preparation** from `main` with the next version (without `v`).
It starts from `latest`, reconciles `main`, rebuilds the previous documentation
snapshot from its exact release tag, prepares the version metadata, validates
the result, and opens a draft release PR into `main`.

```bash
gh workflow run release-prepare.yml --ref main -f version="$NEXT_VERSION"
```

Set `NEXT_VERSION` to the release you intend to prepare and write its notes in
`CHANGELOG.md` under `Unreleased` first. Preparation moves those notes into the
new version section and preserves published changelog history. Existing
archives are compared with the tagged source and never silently overwritten.

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
archived previous documentation, and a changelog section. Documentation and
workflow-only changes can retain the version. The check is preparation evidence,
not a release seal or permission to publish.

For a preparation PR targeting `latest`, merge the reviewed changes there and
then manually merge the release into `main`. The tagging helper works only once
HEAD matches the current remote `main` commit and the checkout is clean:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
npm run release:tag -- 1.0.0-beta.5
npm run release:tag -- 1.0.0-beta.5 --write
```

The first invocation checks and prints the plan. `--write` creates an annotated
local `v1.0.0-beta.5` tag and prints the exact push and workflow commands for the
release owner. It never pushes, dispatches publication, claims a seal, or replaces
an existing tag. A matching tag is idempotent; conflicting commits, lightweight
tags and differing local/remote tag objects fail closed. Run those printed
commands only after review. The publication workflow seals the final tagged
commit before protected publication approval.

After review and merge, the release owner tags the final `main` commit and runs
**npm publication** from that tag. Its candidate job automatically runs
`release:seal`, packs the release, and seals the exact publication bundle before
protected publishing approval. A local seal is useful development evidence but
is not a prerequisite that must be committed before tagging. Reconcile `main`
back into `latest` after the release so development starts from the new version.

For local preparation, the underlying command remains available:

```bash
node scripts/release-prepare.cjs "$NEXT_VERSION" --channel beta --archive-current
```

`--archive-current` requires the committed immutable documentation snapshot.
Use `--replace-unpublished` only when replacing a candidate that has not shipped.
The command updates catalogued metadata and current documentation, runs named
generators, rejects newly changed paths outside its allowlist, and writes an
ignored stale-version-token report. Neither preparation route creates or moves
tags, publishes packages, or deploys documentation. If a tag was created before
the version bump, prepare and merge the metadata first; the release owner must
then correct the unpublished tag before starting publication.

## Authority and trigger

The workflow is manually dispatched **from the exact release tag**, and the `release_tag` input must name that same tag. Candidate construction, publication tooling, GitHub's native source identity, and npm provenance therefore all refer to one commit. A branch-dispatched run fails before artifacts are built. The candidate job has no publication authority. The `publish` job is attached to the protected `npm-publish` environment and is the only job granted `id-token: write`.

For example:

```bash
gh workflow run npm-publish.yml \
  --ref v1.0.0-beta.5 \
  -f release_tag=v1.0.0-beta.5 \
  -f operation=audit
```

Use `operation=publish` only after the audit and external package settings are complete.

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
repository: pulse-compute/pulse
workflow:   npm-publish.yml
environment: npm-publish
```

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

The command derives every package name from the release manifest and writes a timestamped, manifest-digest-bound report to `.pulse-release-preflight/npm-catalog-audit.json`. That report is ignored source evidence: it never rewrites the canonical preflight policy and it performs no registry mutation. Every name must exist with the inert `0.0.0` version and `bootstrap` tag. The `latest` tag may be absent, point to that placeholder, or point to a version both present in the registry and listed in `release/documentation-versions.json`. This preserves existing releases during the next bootstrap audit. Missing versions and unknown release targets remain blocking; any remediation is an explicit human registry action.

Any missing package name requires a one-time human, 2FA-protected bootstrap publication through `scripts/npm_bootstrap.sh <package-name>`. After all names exist:

1. configure the trusted publisher on every package;
2. select the exact release tag as the manual workflow ref;
3. confirm OIDC publication succeeds;
4. remove any temporary bootstrap credential; and
5. prohibit ordinary publish tokens for routine releases.

The production workflow fails rather than silently performing first publication with a broader credential.

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
- the configured dist-tag points to the release version; and
- the published canonical CLI installs in a clean prefix and completes version, init, install, doctor, test, and Node build smoke checks.

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
