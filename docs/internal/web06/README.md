# WEB-06: preservation, staging and single-writer cutover

This is the canonical operating procedure for website recovery and migration.
The website repo owns `recovery-plan.json`, `staging.json`, `deployment.json`,
`scripts/recovery.mjs`, `recover.mjs`, `cutover.mjs`, `cdn-plan.mjs`, the manual
recovery/staging/delivery workflows and review-only Fastly templates. Read the
[WEB-00 contract](../web00/README.md), [WEB-05 delivery procedure](../web05/README.md)
and [existing Pulse deployment procedure](../../maintainers/documentation-deployment.md).

Implementation is available; provider rollout evidence is pending. Production
remains `productionEnabled: false`, `activeWriter: pulse-compute/pulse`, with
empty exact/recovery/retained approvals and `cutover: null`. Staging is disabled
and its `.invalid` origin is a placeholder. No environment, credential, service,
writer setting or source pin is changed by this implementation. A human retains
merge, infrastructure, activation and release authority.

## Capture published storage, then prove recovery

Use a quiet deployment window. Keep the old deployer available, pause dispatches
and wait for its current runs to finish before capturing. The protected
`website-recovery` workflow, dispatched on website main with operation `capture`,
uses current reviewed tooling. It lists only `pulse/`, follows explicit bounded
pages, and performs only head/get against production. Capture has no production
put/delete/sync operation. Use a source credential scoped to read/list that prefix.

Capture includes **every** listed key: root/moving content, original receipts,
all exact releases, assets, unrelated retained keys and any beta.5 partial keys.
It records actual bytes, SHA-256, content type, cache control, user metadata and
present Content-Encoding/Language/Disposition, Expires and redirect metadata.
Provider-generated ETags, modification times and object version IDs are not
portable response metadata. Missing response metadata or unsafe/unrepresentable
keys fail capture for investigation; nothing is silently skipped.

The original `deployments/v1.0.0-beta.7.json` must match its release/tag/source,
complete exact inventory, count and legacy tree digest. Its objects must equal
the captured beta.7 bytes. The five archived trees must equal WEB-00's complete
file count, byte total and original path/length/hash digests. `versions.json`
must have the established schema and exactly those six hosted versions.
Release-local index, quickstart, CLI, CSS/JS and manifests must be present.
The recovery plan separately pins the resolved archived release commits; their
version-site manifests do not contain source SHAs. Capture rechecks the public
release tags without running source code, then repeats the full listing and
reads to reject inventory, byte or metadata churn. A tag rebuild is not accepted
as published recovery. If the actual beta.7 receipt is absent or differs, stop
and recover the original verified deployment candidate/receipt with the release
owner; do not synthesize identity or waive the gate.

A `pulse.website-recovery.v1` snapshot seals that inventory and its recovery plan.
Its SHA-256 is the trust anchor: independently review and record it in the PR and
rollout evidence. A checksum supplied solely by the downloaded bundle is not
authentication. Tests use explicitly synthetic fixtures, never rollout evidence.

The workflow copies the complete snapshot to a **separate backup bucket** under
`pulse-web06-backup/<snapshot-sha256>/`. All backup objects are immutable binary
objects; their internal manifest preserves original response metadata. Every
collision is preflighted, every write is read back, and the recovery manifest is
written last. An interrupted copy can resume; a mismatching object blocks it.
Configure durable retention without automatic expiry and review provider backup/
access protection separately. Git history and 90-day Actions retention are
supplemental, not the durable backup. A successful upload is not a restore proof.

## Protected environments and named authority

Create/configure these environments only through human-reviewed rollout:

| Environment | Authority |
| --- | --- |
| `website-recovery` | Read/list production prefix; write independent backup; separately reviewed operation registers only additive exact receipts |
| `website-staging` | Read backup; head/get/put isolated staging prefix; purge separate staging service |
| `website-production` | Read backup; scoped production delivery after reviewed single-writer handoff |

Restrict to website main, require human review and prevent self approval. The
existing `documentation-production` environment stays Pulse-owned until handoff.
WEB-05 defines `FASTLY_OBJECT_STORAGE_*` and `FASTLY_DOCUMENTATION_*` names. The
backup uses these additional explicit names:

| Kind | Name |
| --- | --- |
| Variable | `FASTLY_BACKUP_BUCKET` (different from source/destination bucket) |
| Variable | `FASTLY_BACKUP_REGION` |
| Variable | `FASTLY_BACKUP_ENDPOINT` (`https://<region>.object.fastlystorage.app`) |
| Secret | `FASTLY_BACKUP_ACCESS_KEY_ID` |
| Secret | `FASTLY_BACKUP_SECRET_ACCESS_KEY` |

Use backup read-only credentials in staging/production. AWS CLI v2 authority is
rebuilt from named credentials; ambient AWS roles/profiles/tokens are removed.
Do not pass any provider secrets to frontend checks or the staging browser job.
The recovery `register` operation needs a separately reviewed production key
that can put only `pulse/deployments/exact/`; regular capture needs no write key.
Change that environment credential only for the explicitly approved operation,
then restore read-only capture authority. The adapter also rejects all other puts.

## Staging restore, public routes and rollback rehearsal

Review `staging.json` with a real HTTPS staging origin, an isolated
`pulse-web06-staging-<id>` prefix and `stagingEnabled: true`; it cannot name the
production origin/prefix or enable production. Choose a fresh isolated prefix
for a new complete rehearsal. Retrying an interrupted identical restore is safe;
an already changed candidate root is a collision during full restore. Never
clean a bucket or delete retained keys to make a restore pass.

Review/adapt website `infra/fastly/*.vcl` for the staging service and existing
Object Storage origin signing. They are templates, not activated configuration.
Map public `/` to the isolated prefix, canonicalize directory slashes, discard
queries only for the origin key, sign **after** rewriting and retain the public
path through 404 fallback. Unknown and unpublished routes must serve the branded
404 with status 404, not a latest redirect or 200. Preserve stored exact response
metadata; the old numeric-only VCL regex misses prereleases. Honor origin immutable
caching for exact versions and content-addressed `_astro/`/demo assets.

Generate a reviewed CSP union from all retained landing/docs and rollback
artifacts, with a provider-confirmed total header budget, for example:

```bash
node scripts/cdn-plan.mjs --artifact /path/to/checked-current --artifact /path/to/checked-rollback --header-budget 8192 --output .pulse-site-preview/cdn-plan.json
```

This verifies the sealed candidates, combines inline hashes, preserves exact
root/demo embedding authority and rejects broad script/style inline permissions
or oversized headers. It does not apply VCL. Confirm existing exact pages remain
compatible with the `self` script/style policy, review Fastly header limits and
substitute the generated root/demo policies. Missing new demo paths must still
receive the demo policy before upload. Review the complete provider service
version, backend signing and error snippets; template checks are not VCL compilation
or service reality evidence.

Dispatch `website-stage.yml` on main with a retained successful main-push website
SHA and the independently reviewed snapshot digest. Its credential-free selection
job verifies CI identity/run/attempt/archive digest; the protected job downloads
backup bytes, checks their external digest and **every** file before any write,
preflights every destination collision, restores original metadata and adds new
preservation receipts. Production restore is not a normal recovery operation.

The rehearsal then:

1. Purges and proves restored public root/latest, legacy manifests and each known
   exact root/quickstart/CLI HEAD/CSS/JS/version manifest by status, bytes and metadata.
2. Delivers the checked landing and docs artifact through the normal tag/npm/exact,
   immutable collision, response-policy, purge and public gates.
3. Proves every retained exact version and legacy manifest is unchanged.
4. Replays only the previous snapshot's mutable roots, with indices last; retains
   exact versions and new assets, purges and proves the old public selection.
5. Reapplies the same checked candidate and leaves it staged for public browser
   checks in a separate job with no provider secrets.

The public browser lane covers desktop/390/320px layout, ARC iframe, keyboard
version disclosure, persisted theme, real Pagefind search/WASM, CSP and no-JS docs.
A failed purge, status, byte, metadata, search, browser or policy check fails the
rehearsal even after storage writes succeeded. Individual storage operations have
bounded retries; publication remains resumable and multi-object, not atomic.
Beta.5 existing keys are retained and recorded. Only when none were captured does
the restored public probe require its root to be 404; no fabricated tree is added.

## Preservation approval and machine consumers

After durable restore/rehearsal review, add the real snapshot digest to website
`deployment.json.recoveryApprovals` with value `protected-storage-capture` in a
human-reviewed PR. Dispatch recovery operation `register` with that digest. It
re-downloads/authenticates backup data, compares every original exact object's
bytes **and full recorded metadata** plus original deployment receipts against
production, preflights all receipt collisions, then puts only new immutable
`deployments/exact/v<version>.json` receipts. Original receipts and exact objects
are never rewritten. Review the resulting `exactReleases` map in deployment config;
the same map was exercised in staging. This is a separate human-approved additive
production action, not implicitly authorized by implementation or capture.

The known in-repository machine consumers are:

| Surface | Consumers and decision |
| --- | --- |
| `versions.json` | Website version links; Pulse documentation system, CLI installed catalog, source checks and release prep. Keep selected-source `pulse.documentation-versions.v1` bytes and meaning. |
| Root `site-manifest.json` | Pulse site builder/validator, local preview existence check, deployment public check and coupled qualification. Preserve as the legacy snapshot; keep those readers until WEB-07. |
| Root `public-site-manifest.json` | Pulse builder/validator and documentation-release editorial-copy checks. Preserve the old renderer's editorial facts as a snapshot. |
| Exact version-local manifests | Archive validator, exact routes/assets and legacy qualification. Preserve all bytes/metadata. |
| `website-manifest.json` | Additive `pulse.website-site.v1` reports the new renderer's selected-source pages/assets/aliases and website identity. |

This source audit cannot discover external consumers. The infrastructure owner
must record the public/external consumer review before activation; do not claim
that an old schema describes new theme behavior. No legacy schema adapter is
necessary for the current additive transition. Migrating/removing legacy readers
and coupled candidate qualification remains WEB-07 after successful cutover.

## Durable candidates, activation and rollback

Before GitHub expiry, dispatch recovery operation `retain` for each independently
successful landing/docs selection. It rechecks live main-push artifact identity,
seals **all** artifact and binding bytes, and writes the independent durable
backup. Review each resulting recovery digest in `retainedArtifacts` as
`{ candidateSha256, websiteCommit, sourceCommit }`. Restore authenticates that
committed reviewed digest, original CI binding and every candidate byte without
executing candidate code or accepting a new PR/rebuild as a replacement.

Prepare a human-reviewed `pulse.website-cutover.v1` record in deployment config.
It must contain `status: approved`, actual snapshot/source identities, staging
origin/prefix, reviewer/time, and `{ run, sha256 }` for each backup, restore,
routes, browser, rollback, CDN and consumer evidence. Run URLs must identify
Pulse/website Actions runs and hashes must match the reviewed reports. Its
`rollback.landing` and `rollback.docs` reference approved durable candidate digests.
Do not populate this record with local simulation results or fixture identities.

Coordinate the production window explicitly across repositories:

1. Confirm durable data can be fetched with separate read-only authority and
   reports bind the intended candidate/source/prefix/CDN policy. Retain the old
   service version and snapshot; prepare both initial and later rollback choices.
2. Disable/restrict Pulse `documentation-deploy.yml` and its production write
   authority through human-owned settings, then drain **all** active/queued old
   runs. Keep its code/accepted artifact path for a deliberate reverse handoff.
3. Record `writer: { previous: pulse-compute/pulse, next: pulse-compute/website,
   oldDisabled: true, oldRunsDrained: true, evidence: { run, sha256 } }` with actual
   handoff evidence. GitHub concurrency groups never span repositories.
4. Review/apply the production service policy, then approve deployment config
   with exact receipts, durable rollback identities, that cutover record,
   `activeWriter: pulse-compute/website` and `productionEnabled: true`. The guard
   rejects enabling flags alone, incomplete evidence, missing known archives,
   a beta.5 approval or an undrained old writer.
5. Dispatch normal website landing/docs delivery and record receipts and public
   checks. Keep the old writer restricted; each later candidate needs compatible
   CSP, exact-release evidence and durable retention before it becomes rollback.

For later website rollback, select the previous retained website SHA/phase in
`website-deploy.yml`. If GitHub retention expired, supply its committed approved
`durable_digest`; current main tooling fetches/validates the same saved bytes,
then uses the same production gates. A full SHA remains an input for clarity;
the durable path takes its actual identity from the reviewed recovery record.
Use separate landing/docs digests when their last successful selections differ.

For the **initial migration** rollback, additionally supply
`legacy_snapshot_digest` equal to the reviewed cutover snapshot. Select a checked
(or durably retained) candidate at that snapshot's released source; it supplies
verified tag/npm facts. The rollback compares every original known exact object,
then restores only original `.nojekyll`, root/404/legacy manifests/version index
and `latest/**` with their original metadata, indices last. It restores both old
aliases regardless of phase input, preserves original receipts, exact versions,
unrelated keys and newer website assets, purges and verifies the old public
selection. It never rebuilds the old site or activates the old writer concurrently.
A reverse writer handoff must first disable/drain website writing before restoring
Pulse authority; do not solve a failed public check by enabling both writers.

## Implementation validation versus rollout evidence

Local Node tests use synthetic storage/CI/npm/CDN fixtures to exercise complete
capture, churn, archive/receipt tampering, metadata, backup interruption/collision,
authenticated fetch, isolated restore, preservation registration, both rollback
paths, expired candidate retention, wrong authority and missing handoff gates.
Run `npm test` in website, then the WEB-05 frontend checks. Pulse validation uses
maintainer/docs synchronization and checks, documentation-release and publication
simulations. These commands do not capture production, create environments,
validate actual VCL, write storage or prove public staging.

WEB-07 remains gated on actual reviewed successful rollout, not this implementation
PR or a synthetic green test run. Committed archives, old renderer, npm qualification
and already accepted candidate readers stay in Pulse until then.
