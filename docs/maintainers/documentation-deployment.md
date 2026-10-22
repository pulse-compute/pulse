<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-21
review-by: 2027-04-21
pulse-doc-meta:end -->

# Documentation deployment

Website rendering and production delivery now belong to
[`pulse-compute/website`](https://github.com/pulse-compute/website). This checkout
has no deployment workflow, storage adapter, candidate sealer or public-delivery
command. Package publication controls and historical v1 candidate authentication
remain in Pulse. The **Documentation** workflow checks sources and installed
copies; it does not render, seal or upload a website.

## Writer retirement boundary

`release/documentation-writer-retirement.json` records source retirement on
`latest` and the historical workflow identity **328773030**, established by
[its retained run](https://github.com/pulse-compute/pulse/actions/runs/37858976410).
That run is identity evidence, not proof of current disabled state or an idle
queue. Nathan reports the workflow disabled; this change makes no live-state
claim and changes no settings or credentials.

The website delivery guard uses that numeric identity,
requires a live disabled workflow and no queued, requested, pending, waiting or
in-progress runs before writes, and rejects unknown state, identity mismatch,
HTTP 404 or API failure. Deleting a file on `latest` does not retire the writer
on `main`, tags or historical refs, or drain existing runs. Keep the old workflow
disabled. Full removal of the live identity requires a separately reviewed
credential/authority retirement and drain mechanism; absence is never evidence.
The website retains its existing handoff state transitions and protected gate.

The retained `release/documentation-deployment.json` describes historical v1
receipts. `scripts/documentation-deployment.cjs` is now a read-only verifier.
New v2 source-only qualifications cannot satisfy a historical v1 documentation
candidate requirement; missing or tampered retained candidates still fail.

The sections below document historical object, credential and delivery behavior
for recovery and receipt interpretation. They are not current dispatch
instructions. The complete prior implementation is retained at
[the beta.9 source](https://github.com/pulse-compute/pulse/tree/fda16de1b3520c65cc62574878727e753ade850c).
Never re-enable that writer as part of routine website delivery.

## Object classes

The `1.0.0-beta.10` layout is:

```text
<bucket>/pulse/
  index.html                         mutable
  404.html                           mutable
  latest/**                          mutable
  versions.json                      mutable
  site-manifest.json                 mutable
  public-site-manifest.json          mutable
  v1.0.0-beta.10/**                         immutable
  deployments/v1.0.0-beta.10.json           immutable receipt
```

The exact-version tree is the archival release. Root and `latest` are convenience surfaces promoted only after exact-version verification and matching npm package verification.

Upload and storage verification select only the current exact-version tree, its deployment receipt, and the configured mutable routes. Historical version trees may remain in the sealed candidate for local preview; a later release never uploads, reads, or verifies those historical storage keys. Candidate counts include those preview files, while deployment and storage-verification reports count only selected objects.

The deployment workflow and script never delete objects. Historical versions and unrelated bucket content are not candidates for synchronization. For a selected immutable key:

```text
missing
  → upload

present with matching bytes, content type, and cache policy
  → accept as idempotent

present with different bytes or metadata
  → fail before promotion
```

Mutable objects may be replaced during a deliberate promotion. Their cache lifetime is short; exact-version objects are published with one-year immutable caching.

## Sealed deployment candidate

Historical v1 candidates remain readable. Pulse no longer builds or seals new
website candidates; website delivery owns future rendered artifacts. To verify
an already retained candidate locally:

```bash
npm run docs:deployment:verify
```

`.pulse-documentation-deployment/documentation-deployment-manifest.json` records every object key, local source, byte length, SHA-256, content type, cache class, mutability, source commit, public documentation route, and independent storage prefix. Its deterministic deployment receipt records the complete generated-site digest and the exact-version object inventory and tree digest for `deployments/v1.0.0-beta.10.json`. Candidate verification checks the full sealed inventory, including historical preview files, before any storage operation and rejects any root or site file outside that inventory. Sealing also rejects paths outside the approved object classes.

`npm run publication:check` now exercises the historical reader with synthetic
v1 fixtures: missing or altered bytes, unexpected site/root files, incomplete
checksums, invalid source identity and receipt digest tampering must fail.
Storage-write simulations belong to the website's delivery tests. The synthetic
fixture producer is test support, not a production sealer or release artifact.

## Historical Object Storage credentials

Use separate bucket-limited credentials:

| Principal | Required scope | Repository location |
|---|---|---|
| GitHub deployment workflow | read/write | `documentation-production` environment secrets |
| Fastly private origin | read-only | protected Fastly service configuration |

The GitHub environment provides:

```text
Secrets
  FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID
  FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY
  FASTLY_DOCUMENTATION_PURGE_TOKEN

Variables
  FASTLY_OBJECT_STORAGE_BUCKET
  FASTLY_OBJECT_STORAGE_REGION
  FASTLY_OBJECT_STORAGE_ENDPOINT
  PULSE_DOCUMENTATION_ORIGIN
  PULSE_DOCUMENTATION_BASE_PATH
  FASTLY_DOCUMENTATION_SERVICE_ID
```

The deployer supplies only these bucket credentials to AWS CLI v2. It clears ambient profiles, session tokens, web-identity roles, container-credential endpoints, and generic AWS endpoint overrides, and points AWS config and shared-credential lookup at the platform null device. This prevents unrelated runner credentials from influencing Object Storage requests.

The workflow requires AWS CLI v2, maps the two secrets to its standard credential variables and sends S3-compatible requests to the selected Fastly regional endpoint. Fastly Object Storage rejects the AWS CLI's optional request-checksum behavior, so both the protected deployment job and the deployment adapter set `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`. Storage reads likewise use `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required`. These are fixed compatibility settings, not repository environment variables or credentials.

The read-only VCL origin key must never be reused as the deployment key, and the read/write deployment key must never be embedded in VCL.

For CDN invalidation, set `FASTLY_DOCUMENTATION_SERVICE_ID` to the Fastly service serving the public documentation origin. Use a separate `FASTLY_DOCUMENTATION_PURGE_TOKEN` restricted to that service with the `purge_all` scope. It is a Fastly API token, not an Object Storage credential. These values are required only when `promote_latest` is enabled; the workflow checks them before changing mutable objects.

## VCL delivery boundary

The VCL service owns delivery concerns, not content generation:

- host or path routing;
- GET and HEAD admission;
- directory `index.html` normalization and canonical slash redirects;
- private Object Storage SigV4 origin signing;
- bucket and object-prefix rewriting;
- immutable versus moving-alias cache policy;
- branded 404 behavior;
- content and security headers; and
- removal of storage-specific response headers.

Origin signing remains owned by the human Fastly infrastructure operator. The
website still uses the existing private-origin mechanism; no equivalent signing
template has been transferred. Retain `infra/fastly/documentation/origin-signing.vcl`
and its surrounding historical templates until that consumer is migrated and
reviewed. Historical HTML copies are removed from `latest`; their small product
metadata and the original beta.1 capture record remain in
`release/documentation-release-history/`. Historical readers use supplied artifacts.

The checked-in snippets contain protected credential placeholders and are not activated automatically. A human infrastructure/release owner must create and configure the Fastly service, test a non-production service version, and activate it.

## Historical promotion and public verification

The historical workflow performed these steps in order:

1. verify the downloaded documentation candidate and its exact release-tag identity;
2. upload or verify only the current release's immutable exact-version objects and deployment receipt;
3. query npm for all matching package versions and configured dist-tags, then verify the protected CDN purge configuration;
4. upload mutable manifests, error pages, and alias payloads using that npm verification report, then write `latest/index.html` and root `index.html` last as the release-owned publication points;
5. verify the mutable objects directly in Object Storage;
6. issue a hard purge using `POST https://api.fastly.com/service/<service-id>/purge_all` and require a successful response;
7. request homepage, latest, getting started, the moving site manifest, exact version, CSS, and a missing path through the configured Fastly public origin; and
8. retain object, registry, purge, and HTTP evidence as workflow artifacts.

Public verification checks that the moving routes and `site-manifest.json` expose the new release version. The hard purge invalidates all cached objects on the configured documentation service, including stale aliases and cached missing paths. It runs after mutable storage verification and before any public checks; a failed purge stops public verification. The existing verification retry window still allows CDN propagation. Immutable-only deployments skip the purge. `documentation-cdn-purge.json` retains the API response with the deployment evidence.

Workflow changes take effect in a future reviewed release tag. Rerunning an existing tag uses that tag's workflow; it does not pick up later changes from `main`.

No bucket-wide synchronization or delete operation is used. Mutable promotion is resumable and idempotent, but it is not presented as a cross-object atomic transaction. Writing the two publication points last minimizes partially visible promotions; a failed run is rerun against the same sealed candidate.

Codex may diagnose a failed deployment and prepare a patch. It may not approve `documentation-production`, supply credentials, alter the public origin, activate VCL, or promote documentation independently of human release authority.

Use the [release handoff record](npm-publishing.md#release-handoff-record) to
track candidate, immutable storage, npm gate, alias promotion, and public-route
evidence separately. Deployment and storage-verification failures with
`--json-out` retain a failed report containing a failure code and the selected
object key. Immutable conflicts also name whether bytes, content type, or cache
policy differed. The workflow uploads these reports even when a deployment step
fails; only a terminal passing report at the exact tag establishes that stage.
