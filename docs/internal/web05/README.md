# WEB-05: website artifacts and reviewed delivery

This repository owns the operating procedure. The website repository owns
`.github/workflows/checks.yml`, `website-deploy.yml`, `deployment.json` and the
artifact/delivery scripts. Product source, release qualification and publication
remain Pulse-owned. This implements WEB-05; it does not activate a writer,
create an environment, configure secrets, change Fastly or promote a source pin.
Keep [the migration contract](../web00/README.md) and the existing
[Pulse deployment procedure](../../maintainers/documentation-deployment.md).

## Artifact and authority

Website PR and main-push checks use Node 24.18.0, the committed npm lock and a
separate read-only checkout at `source-lock.json`'s tag/full SHA. They run source,
route, anchor, code, asset, docs/search, landing and browser checks; no Pulse
compiler/package qualification runs. PRs retain noindex preview output. Main
builds produce indexable candidates. Neither check receives storage/CDN secrets.
The current baseline remains the WEB-00 published beta.7 capture; advancing the
source requires a reviewed baseline/version-link update with the source-pin PR.

`pulse.website-artifact.v1` binds website commit/tree, Pulse commit/tree/tag,
source lock, npm lock, deployment inputs, import provenance, release manifest,
source package dependency facts, build run/attempt/event, runtime version and
the complete file inventory with SHA-256, byte length, content type and cache
control. It includes an artifact-specific CSP proposal. Unknown files, symlinks,
traversal, duplicate objects, metadata changes and missing evidence fail
verification. `proof/` renderer probes are excluded from deployment; normal
builds contain no historical exact-version copies.

Checks upload `website-<full-sha>-<run-id>-<attempt>` with 90-day retention.
Manual delivery selects a full website SHA that is an ancestor of current main,
then accepts only a successful same-repository main-push `checks.yml` run and
its exact, unexpired artifact ID/attempt/archive digest. The selection summary
records both source identities and candidate/archive digests before protected
approval. After approval, current-main tooling rechecks GitHub identity,
retention, attempt and all artifact bytes. It neither installs dependencies nor
executes/builds the selected artifact's code. A PR artifact is never deployable.
A rerun or expired artifact requires a new selection; it cannot silently fall
back to another build after approval.

## Operations and storage boundary

| Phase | Selected writes | Pre-write gates |
| --- | --- | --- |
| `landing` | Root index/favicon, content-addressed `_astro/` and demo assets, phase receipt | Checked artifact, protected writer, valid storage/purge configuration, all immutable collisions |
| `docs` | `latest/`, Pagefind, 404, `versions.json`, additive `website-manifest.json`, shared assets, phase receipt | Landing gates plus preserved exact-tree receipt and every catalogued npm package's exact metadata/tarball |

Landing has no npm or exact-doc publication operation. Shared hashed assets may
already exist for either phase; they can only be reused with identical bytes,
content type and cache control. Exact `v<version>/` trees, legacy deployment
receipts, legacy `site-manifest.json` and `public-site-manifest.json`, unrelated
keys and older assets are never written or deleted by these phases. Root
`versions.json` retains the selected source's established
`pulse.documentation-versions.v1` bytes/schema. The additive website manifest
reports the new renderer without relabeling old manifest fields. WEB-06 must
inventory existing root-manifest consumers and review their eventual adapter;
legacy presentation facts remain snapshots while the renderer changes.

The AWS adapter uses only head/get/put on `pulse/<approved-path>`, with the
named Fastly endpoint and credentials. It clears ambient AWS roles, profiles,
session tokens, credential/endpoint files and container/web-identity authority;
AWS CLI v2 uses `when_required` request/response checksums. It reads actual
object bytes as well as content type/cache control, never trusting only a hash
metadata field. There is no list/sync/delete or bucket-wide cleanup operation.
Immutable cache is `public, max-age=31536000, immutable`; moving content is
`public, max-age=60, stale-while-revalidate=300`; 404 is `public, max-age=60`.

Every immutable collision is checked before mutable writes. Individual storage
operations retry four times and verify read-back bytes/metadata. The applicable
root index is written after the phase's other content. An immutable deterministic
`deployments/website/<candidate-sha256>/<phase>.json` records the selection.
Mutable publication spans multiple objects and is resumable, not atomic.
Workflow concurrency serializes both phases without cancelling an active write.

Docs verifies exact npm name/version, source dependency fields, optional
`gitHead`, same-registry tarball URL, SHA-512 integrity and SHA-1 shasum for every
package in the selected manifest. It streams bounded tarballs; it does not
install packages, compile Pulse or repeat qualification. It intentionally does
not require npm's moving dist-tag to still equal an older release, so a retained
released source remains eligible for rollback after `latest` advances.

After complete storage verification, delivery purges the configured Fastly
service and requires `status: ok`, then probes public root/docs, CSS/demo/search,
exact quickstart, exact CLI HEAD, version/website manifests and unknown/unpublished
routes as applicable. Probes require CDN headers, expected status/content type/
cache and actual body hashes (HEAD checks length), with eight bounded attempts.
A purge or public mismatch fails delivery even when storage writes succeeded;
retry the same retained selection after resolving the cause.

## WEB-06 environment and preservation handoff

`productionEnabled: false`, `activeWriter: pulse-compute/pulse` and an empty
`exactReleases` map mechanically prevent website production writing today.
The existing Pulse workflow remains usable. Implementation review does not
authorize either writer activation or environment/settings changes.

The infrastructure owner must complete staging, restore and rollback evidence,
then explicitly review the single-writer switch before changing that config.
Disable/restrict the old writer before enabling the website writer; GitHub
concurrency groups do not coordinate across repositories. Require human review
for `website-production`, restrict it to main and prevent self approval.
Configure only these existing provider names:

| Kind | Name |
| --- | --- |
| Variable | `FASTLY_OBJECT_STORAGE_BUCKET` |
| Variable | `FASTLY_OBJECT_STORAGE_REGION` |
| Variable | `FASTLY_OBJECT_STORAGE_ENDPOINT` (`https://<region>.object.fastlystorage.app`, no trailing slash) |
| Variable | `FASTLY_DOCUMENTATION_SERVICE_ID` |
| Secret | `FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID` |
| Secret | `FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY` |
| Secret | `FASTLY_DOCUMENTATION_PURGE_TOKEN` (service-scoped purge authority) |

Preserve each published exact tree's actual bytes, content type and cache
control in durable storage, including beta.7 from the original verified artifact
or production capture. A fresh tag rebuild is insufficient. WEB-06's recovery
capture produces a reviewed `pulse.website-exact.v1` receipt:

```json
{
  "schemaVersion": "pulse.website-exact.v1",
  "releaseVersion": "1.0.0-beta.7",
  "sourceCommit": "be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb",
  "objects": [
    { "path": "v1.0.0-beta.7/index.html", "bytes": 0,
      "sha256": "REPLACE_WITH_CAPTURED_HASH", "contentType": "text/html; charset=utf-8",
      "cacheControl": "REPLACE_WITH_CAPTURED_METADATA" }
  ]
}
```

The example is a shape, not accepted evidence: include **every captured file**,
with its real length/hash/metadata and original artifact/legacy-receipt recovery
provenance retained alongside it. The gate requires index, quickstart, release
and version-site manifests; public checks also require the CLI route.
Review the captured receipt hash in website `exactReleases[version]` as
`{ sourceCommit, receiptPath: "deployments/exact/v<version>.json", receiptSha256 }`.
Restore that new receipt with immutable JSON metadata through WEB-06's reviewed
recovery tooling; preserve the original `deployments/v<version>.json` unchanged.
Docs delivery reads the approved receipt and compares **every** listed stored
object's bytes/metadata before writing moving aliases. It never uploads/rebuilds
an exact tree. A new release therefore requires separately checked immutable
publication/recovery evidence before moving-doc promotion. Beta.5 remains the
explicit docs-unpublished exception; no fabricated exact tree or latest redirect.

Fastly's old `script-src 'self'; style-src 'self'` blocks Astro inline scripts/
styles and Pagefind WASM. Each candidate's `response-policy.json` proposes exact
script/style hashes plus `wasm-unsafe-eval` for Pagefind and inline style
attributes for UI geometry. CSP browser checks exercise that proposal locally.
Production delivery also checks that the currently served CDN policy covers every proposed directive and
hash before writes and after purge; a missing policy/token blocks the operation.
WEB-06 must review service header limits, combine policies needed by independently
retained landing/docs artifacts and existing exact pages, apply cache/routing
rules for the new asset paths, and verify the policy publicly in staging before
writer activation. A filesystem simulation does not prove provider behavior.

## Retry, rollback and local evidence

After activation, dispatch website delivery on main with the selected retained
website full SHA and either `landing` or `docs`. Review the selection summary in
the protected environment. Record the successful candidate digest, source pin,
phase receipt and public checks in rollout evidence. To retry, select the same
retained SHA/phase; already matching objects are skipped.

Before first cutover retain the previous verified website artifact and released
source pin durably; the pre-cutover Pulse artifact needs WEB-06's reviewed
recovery path. Rollback selects that prior checked website SHA and repeats the
relevant phase(s) through the same protected workflow. Use separate recorded
landing/docs selections if their last successful deployments differ. Exact
versions and newer hashed assets remain intact. If CDN checks failed after
writes, choose explicitly between completing that selection and restoring the
previous selection; do not claim the failed operation changed nothing.

GitHub artifact expiry is not a backup. WEB-06 establishes durable recovery and
restore authentication before cutover; this workflow deliberately refuses an
expired artifact rather than rebuilding it or guessing a replacement.

For a local credential-free rendering and landing delivery simulation, from a
clean committed website checkout with dependencies/browser installed:

```bash
npm test
npm run check
PULSE_SITE_PRODUCTION=1 npm run build
npm run verify:import
npm run verify:proof
npm run verify:landing
PULSE_BASELINE=/path/to/pulse/docs/internal/web00/published-beta7.json npm run verify:docs
npm run test:browser
npm run test:landing
npm run test:docs
PULSE_SITE_PRODUCTION=1 npm run artifact:seal
PULSE_RESPONSE_POLICY=.pulse-site-artifact/response-policy.json npm run test:docs
PULSE_RESPONSE_POLICY=.pulse-site-artifact/response-policy.json npm run test:landing
npm run artifact:verify
npm run deliver -- --driver filesystem --storage /tmp/web05-store --phase landing
```

Sealing refuses an existing output directory and a dirty tracked/untracked
website checkout. Choose fresh artifact/storage paths for independent runs.
The focused tests seed synthetic exact receipts and mocked npm/CDN responses to
exercise docs pre-gates, checksum failures, metadata/byte collisions, interruption,
retry, rollback, phase isolation, wrong authority, PR/fork/rerun/expired artifact
rejection and purge-before-public ordering. They do not access production.

The [WEB-06 preservation and cutover procedure](../web06/README.md) now owns
recovery capture, durable backups, staging/rollback rehearsal, additive exact
receipts and reviewed writer activation. Provider evidence remains a rollout gate.
