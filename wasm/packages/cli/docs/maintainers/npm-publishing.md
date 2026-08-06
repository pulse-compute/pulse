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

Use the manifest-owned preparation policy instead of repository-wide version replacement:

```bash
pnpm release:prepare -- 1.0.0-beta.2 --channel beta --replace-unpublished
```

`--replace-unpublished` replaces the current candidate without inventing release history. After a version has actually shipped, use `--archive-current`; that mode requires the committed immutable documentation snapshot. The command updates only catalogued JSON, package, guest-metadata, and current-documentation owners, runs named generators, rejects newly changed paths outside its allowlist, and writes an ignored stale-version-token report for review.

Release preparation never creates a Git tag and never contacts npm. A human release authority creates the exact `v<version>` tag from the reviewed, sealed commit as a separate action.

## Authority and trigger

The workflow is manually dispatched **from the exact release tag**, and the `release_tag` input must name that same tag. Candidate construction, publication tooling, GitHub's native source identity, and npm provenance therefore all refer to one commit. A branch-dispatched run fails before artifacts are built. The candidate job has no publication authority. The `publish` job is attached to the protected `npm-publish` environment and is the only job granted `id-token: write`.

For example:

```bash
gh workflow run npm-publish.yml \
  --ref v1.0.0-beta.1 \
  -f release_tag=v1.0.0-beta.1 \
  -f operation=audit
```

Use `operation=publish` only after the audit and external package settings are complete.

A human release authority must approve that environment. Codex may inspect failures and prepare bounded patches, but it may not dispatch the release, approve the environment, publish a package, change a dist-tag, or rotate registry credentials.

## Trusted publishing

Pulse uses npm trusted publishing through GitHub Actions OIDC. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` is provided. Published packages support `^22.14.0 || ^24.0.0`; local development supports pnpm `>=10 <11`. Release packing, CI, and the portable dependency bundle select the exact pnpm version in the release manifest (currently 10.0.0). Local release seals accept Node `^24.0.0` and record the exact patch used. The protected publication workflow remains reproducibly pinned to Node 24.18.0 and npm 11.15.0, and `scripts/release-publication.cjs` rejects a different Node patch, a different npm version, or known long-lived npm credential variables in that job.

Every manifest-owned npm package setting must authorize exactly:

```text
repository: pulse-compute/pulse
workflow:   npm-publish.yml
environment: npm-publish
```

The workflow publishes public packages directly under the dist-tag in the
release manifest. OIDC is deliberately not combined with a post-publication
`npm dist-tag` mutation. The protected script verifies the native GitHub tag ref
and SHA against the sealed candidate before the first publish.

## One-time package bootstrap

An npm trusted publisher can be configured only after the package name exists under the intended owner. Before enabling production publication, run:

```bash
npm run release:audit-npm
```

The command derives every package name from the release manifest and writes a timestamped, manifest-digest-bound report to `.pulse-release-preflight/npm-catalog-audit.json`. That report is ignored source evidence: it never rewrites the canonical preflight policy and it performs no registry mutation. The audit is ready only when every name exists, `bootstrap` points to `0.0.0`, and `latest` is either absent or still points to the same inert `0.0.0` placeholder. A different `latest` target remains blocking and any required dist-tag remediation is an explicit human registry action.

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

## Verification

The protected publish job verifies each package immediately. A separate unprivileged job then confirms:

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
