<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Documentation deployment

Pulse documentation is generated static output. It is not deployed as a Pulse Compute application. The production path stores exact-version and moving-alias objects in Fastly Object Storage, then serves them through a small VCL delivery layer.

```text
source documentation + release catalogs
→ generated site
→ sealed object manifest
→ immutable exact-version upload
→ matching npm release verification
→ root/latest promotion
→ public verification through Fastly
```

The machine-readable deployment contract is `release/documentation-deployment.json`. The production workflow is `.github/workflows/documentation-deploy.yml`. Reviewed VCL templates and the operating guide live under `infra/fastly/documentation/`.

## Validation and production are separate

The **Documentation** workflow runs for pull requests and `main`. It validates generated documentation, builds the exact-version site, seals a preview object manifest, and uploads a short-lived Actions artifact. It has no storage secret and no deployment job.

The **Documentation deployment** workflow is dispatched **from the exact release tag**, and its `release_tag` input must name the same tag. A branch-dispatched run fails before candidate construction. The candidate job builds and seals the site without credentials. Its `deploy` job is attached to the protected `documentation-production` environment, reuses the same tagged tooling and source identity, and receives credentials only after a human release/infrastructure authority approves the environment.

GitHub Pages deployment is no longer part of the repository workflow. The release catalog's current public origin must be changed to the final Fastly-served hostname before production activation; the deployment verifier rejects an environment-provided public origin that differs from `release/pulse-release-manifest.json`.

## Object classes

The `1.0.0-beta.2` layout is:

```text
<bucket>/pulse/
  index.html                         mutable
  404.html                           mutable
  latest/**                          mutable
  versions.json                      mutable
  site-manifest.json                 mutable
  public-site-manifest.json          mutable
  v1.0.0-beta.2/**                         immutable
  deployments/v1.0.0-beta.2.json           immutable receipt
```

The exact-version tree is the archival release. Root and `latest` are convenience surfaces promoted only after exact-version verification and matching npm package verification.

The deployment workflow and script never delete objects. Historical versions and unrelated bucket content are not candidates for synchronization. For an immutable key:

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

Build and inspect locally:

```bash
npm run docs:site
npm run docs:deployment:prepare
npm run docs:deployment:verify
```

`.pulse-documentation-deployment/documentation-deployment-manifest.json` records every object key, local source, byte length, SHA-256, content type, cache class, mutability, source commit, public documentation route, and independent storage prefix. Its deterministic deployment receipt records the complete generated-site digest and the exact-version object inventory and tree digest for `deployments/v1.0.0-beta.2.json`. Candidate verification rejects any root or site file outside that sealed inventory.

A local adapter exercised by `npm run publication:check` proves:

- first immutable upload;
- idempotent retry;
- rejection of an altered immutable object;
- npm-gated mutable promotion; and
- preservation of unrelated objects without any delete operation.

## Object Storage credentials

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

Variables
  FASTLY_OBJECT_STORAGE_BUCKET
  FASTLY_OBJECT_STORAGE_REGION
  FASTLY_OBJECT_STORAGE_ENDPOINT
  PULSE_DOCUMENTATION_ORIGIN
  PULSE_DOCUMENTATION_BASE_PATH
```

The deployer supplies only these bucket credentials to AWS CLI v2. It clears ambient profiles, session tokens, web-identity roles, container-credential endpoints, and generic AWS endpoint overrides, and points AWS config and shared-credential lookup at the platform null device. This prevents unrelated runner credentials from influencing Object Storage requests.

The workflow requires AWS CLI v2, maps the two secrets to its standard credential variables and sends S3-compatible requests to the selected Fastly regional endpoint. Fastly Object Storage rejects the AWS CLI's optional request-checksum behavior, so both the protected deployment job and the deployment adapter set `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`. Storage reads likewise use `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required`. These are fixed compatibility settings, not repository environment variables or credentials.

The read-only VCL origin key must never be reused as the deployment key, and the read/write deployment key must never be embedded in VCL.

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

The checked-in snippets contain protected credential placeholders and are not activated automatically. A human infrastructure/release owner must create and configure the Fastly service, test a non-production service version, and activate it.

## Promotion and public verification

The production workflow performs these steps in order:

1. verify the downloaded documentation candidate and its exact release-tag identity;
2. upload or verify every immutable exact-version object and immutable release receipt;
3. query npm for all 18 matching package versions and configured dist-tags;
4. upload mutable manifests, error pages, and alias payloads using that npm verification report, then write `latest/index.html` and root `index.html` last as the release-owned publication points;
5. verify the mutable objects directly in Object Storage;
6. request homepage, latest, getting started, the moving site manifest, exact version, CSS, and a missing path through the configured Fastly public origin; and
7. retain object, registry, and HTTP evidence as workflow artifacts.

Public verification checks that the moving routes and `site-manifest.json` expose the new release version. It retries within the release-owned window so the one-minute alias cache can converge without a privileged CDN purge token.

No bucket-wide synchronization or delete operation is used. Mutable promotion is resumable and idempotent, but it is not presented as a cross-object atomic transaction. Writing the two publication points last minimizes partially visible promotions; a failed run is rerun against the same sealed candidate.

Codex may diagnose a failed deployment and prepare a patch. It may not approve `documentation-production`, supply credentials, alter the public origin, activate VCL, or promote documentation independently of human release authority.
