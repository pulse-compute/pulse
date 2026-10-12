# Website migration: one maintenance window

Approved direction, 2026-10-12: use the existing region, bucket, prefix and CDN;
downtime during migration or recovery is acceptable. This procedure supersedes
the mandatory staging, separate-backup-bucket and multi-report cutover gates in
the original WEB-00/05/06 plan. The older workflow remains optional.

There is one website production environment. A verified archive on your own
computer is the migration backup. Website CI still checks the candidate; exact
historical releases remain unchanged. WEB-07 can be prepared before cutover;
merge its removals after the production checks below pass.

These are operator actions. Merging the implementation PR does not execute them.
The configuration stays disabled until the separate, real-backup configuration
PR in step 5. Never fill approval fields with test data.

## 1. Merge the tooling PR and prepare your computer

Merge the website maintenance-window tooling PR. Keep Pulse #248 open.
Use Node 24, Git, GitHub CLI (`gh`, authenticated to both repos) and AWS CLI v2.
The maintenance commands use Node built-ins and need no `npm install`.

```bash
gh repo clone pulse-compute/website
cd website
git switch main
git pull --ff-only
node --version
aws --version
gh auth status
```

If you already have the checkout, start with `cd website`. Run all remaining
commands from this checkout, in the same terminal. For a later terminal, restore
the backup-directory variables from the paths you saved.

In website **Settings → Environments**, create `website-production`, restrict
deployment branches to `main`, and configure these values from the existing
Pulse documentation deployment. Use a reviewer if your repository plan and team
support one; a solo maintainer must be able to approve their own requested rollout.

| Environment variables | Value |
| --- | --- |
| `FASTLY_OBJECT_STORAGE_BUCKET` | Existing documentation bucket |
| `FASTLY_OBJECT_STORAGE_REGION` | Existing bucket region |
| `FASTLY_OBJECT_STORAGE_ENDPOINT` | `https://<that-region>.object.fastlystorage.app`, no trailing slash |
| `FASTLY_DOCUMENTATION_SERVICE_ID` | Existing production CDN service |

| Environment secrets | Value |
| --- | --- |
| `FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID` | Storage key for the existing bucket |
| `FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY` | Its secret |
| `FASTLY_DOCUMENTATION_PURGE_TOKEN` | Token allowed to purge that service |

GitHub cannot reveal an existing secret; use your original credential source.
The local capture/register/rollback commands need the same seven names exported
in this terminal. Enter credentials privately using your normal secret manager
or hidden shell prompts; never commit them. Capture needs list/head/get on
`pulse/`; registration adds puts under `pulse/deployments/exact/`; rollback and
delivery need puts under `pulse/`. No command deletes objects.

Do not create `website-staging`, `website-recovery`, another bucket or any
`FASTLY_BACKUP_*` setting for this path. Local maintenance commands deliberately
refuse CI execution; do not forge GitHub environment variables to run them.

## 2. Stop the old writer

In Pulse **Actions → Documentation deploy**, disable the workflow, or run:

```bash
gh workflow disable documentation-deploy.yml --repo pulse-compute/pulse
gh run list --repo pulse-compute/pulse --workflow documentation-deploy.yml --limit 100 --json databaseId,status,conclusion
```

Wait until every active, queued or approval-waiting old deployment is completed
or cancelled. Confirm this in Actions, including any older waiting runs.
Do not dispatch either deployer while capturing. Disabling dispatch does not
stop an already running job, and cross-repository concurrency does not serialize
the two repos. The old site can continue serving during these steps.

## 3. Capture and verify a saved backup

Choose a permanent local directory outside the checkout. Capture downloads
actual production bytes and portable metadata, validates the beta.7 receipt
and historical versions, then rechecks storage for changes. It writes nothing
to production.

```bash
PULSE_BACKUP_DIR="$HOME/pulse-site-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$PULSE_BACKUP_DIR"
node scripts/maintenance.mjs capture --output "$PULSE_BACKUP_DIR/snapshot" --confirm-writers-stopped true > "$PULSE_BACKUP_DIR/capture.json"
PULSE_SNAPSHOT_SHA=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).sha256)' "$PULSE_BACKUP_DIR/capture.json")
tar -czf "$PULSE_BACKUP_DIR/site-snapshot.tgz" -C "$PULSE_BACKUP_DIR" snapshot
mkdir "$PULSE_BACKUP_DIR/verified"
tar -xzf "$PULSE_BACKUP_DIR/site-snapshot.tgz" -C "$PULSE_BACKUP_DIR/verified"
PULSE_SNAPSHOT_DIR="$PULSE_BACKUP_DIR/verified/snapshot"
node scripts/maintenance.mjs verify --snapshot "$PULSE_SNAPSHOT_DIR" --digest "$PULSE_SNAPSHOT_SHA"
```

Run each command only after the previous one succeeds. Keep the archive,
`capture.json`, and extracted verified directory outside disposable build
folders until the migration and WEB-07 are complete. Keep a copy of the currently
active Fastly service version number too.

The current recovery plan expects the captured six hosted beta versions through
beta.7. If production has advanced or the original receipt is missing, capture
fails. Resolve that concrete mismatch; do not generate a replacement old site
or invent approvals. An interrupted capture must use a fresh output directory.

## 4. Generate the real activation proposal

```bash
mkdir -p .pulse-site-preview
PULSE_REVIEWER=$(gh api user --jq .login)
node scripts/maintenance.mjs prepare --snapshot "$PULSE_SNAPSHOT_DIR" --digest "$PULSE_SNAPSHOT_SHA" --reviewer "$PULSE_REVIEWER" --backup-saved true --accept-downtime true --confirm-writers-stopped true --output .pulse-site-preview/maintenance-deployment.json
```

This derives every exact receipt/hash from the verified backup. It creates a
proposal, without editing the live configuration or writing provider storage.
The confirmations mean that you actually saved and verified the archive,
disabled/drained the old writer and accept interruption during deployment.
No staging URL, evidence run IDs or durable artifact digests need to be invented.

## 5. Review and merge that configuration

```bash
git switch -c ops/website-maintenance-cutover
cp .pulse-site-preview/maintenance-deployment.json deployment.json
git diff -- deployment.json
git add deployment.json
git commit -m "Activate reviewed website maintenance-window cutover"
git push -u origin ops/website-maintenance-cutover
gh pr create --repo pulse-compute/website --base main --title "Activate website maintenance-window cutover" --body "Activate the website writer using the verified operator backup recorded in deployment.json. The old Pulse workflow is disabled and drained; downtime is accepted."
```

Review and merge that PR. This enables eligibility for manual website dispatch;
it does not deploy automatically. Do not run the old workflow again.

```bash
git switch main
git pull --ff-only
node scripts/maintenance.mjs register --snapshot "$PULSE_SNAPSHOT_DIR" --confirm-writers-stopped true
```

Registration rechecks production's historical bytes/metadata and adds only exact
preservation receipts. It never overwrites an existing conflicting receipt or
historical page. A same-snapshot retry is safe.

## 6. Select the checked candidate and update the existing CDN

Wait for **Website checks** on the merged website main commit to pass. Capture
its full SHA and run ID:

```bash
PULSE_WEBSITE_SHA=$(git rev-parse HEAD)
gh run list --repo pulse-compute/website --workflow checks.yml --branch main --event push --commit "$PULSE_WEBSITE_SHA"
```

Set `PULSE_CHECK_RUN` to the successful run's numeric ID from that output, then:

```bash
PULSE_CHECK_RUN=REPLACE_WITH_SUCCESSFUL_RUN_ID
PULSE_CHECK_ATTEMPT=$(gh api "repos/pulse-compute/website/actions/runs/$PULSE_CHECK_RUN" --jq .run_attempt)
gh run download "$PULSE_CHECK_RUN" --repo pulse-compute/website --name "website-$PULSE_WEBSITE_SHA-$PULSE_CHECK_RUN-$PULSE_CHECK_ATTEMPT" --dir .pulse-site-artifact
node scripts/artifact.mjs verify
cat .pulse-site-artifact/response-policy.json
```

Use a fresh `.pulse-site-artifact` directory for another candidate. Keep the
chosen SHA; deploy both phases from that same candidate.

In the **existing Fastly service**, clone the active configuration version.
Keep the current domain, bucket backend and origin-signing credentials.
Apply the candidate's `contentSecurityPolicy` to normal website responses and
`demoContentSecurityPolicy` to `/demos/*.html`. Replace the old CSP assignment
rather than adding a second CSP header. The policy must also apply to missing
demo paths before upload; delivery checks this before writing. Preserve the
other security headers.

Keep public `/` mapped to storage `pulse/`, including `_astro/`,
`pagefind/`, `demos/`, `latest/` and exact versions. Honor stored
`Cache-Control` instead of the old numeric-only version regex, which misses
prereleases. Missing routes need the branded 404 body **and status 404**.
The website's `infra/fastly/routing.vcl` and `response-policy.vcl` show the
recv/fetch/deliver/error blocks; substitute `OBJECT_PREFIX` with `pulse`.
Preserve backend signing after the storage-path rewrite.

Validate and activate this version through Fastly. Keep the previous version
number for rollback. These checked-in templates cannot reveal your currently
active snippet names, ordering or backend symbol; inspect the actual service
before replacing those blocks. This is the one infrastructure-specific step.
No second service or staging origin is involved.

## 7. Deploy, then check the public site

From website **Actions → Website delivery → Run workflow**, select `main`,
set `website_commit` to `PULSE_WEBSITE_SHA`, leave both digest inputs blank,
and choose `landing`. Or:

```bash
gh workflow run website-deploy.yml --repo pulse-compute/website --ref main -f website_commit="$PULSE_WEBSITE_SHA" -f phase=landing
```

Wait for that run to succeed, then dispatch the same SHA with `phase=docs`:

```bash
gh workflow run website-deploy.yml --repo pulse-compute/website --ref main -f website_commit="$PULSE_WEBSITE_SHA" -f phase=docs
```

Approve the production environment if configured. Each phase uploads checked
bytes, purges the CDN and performs public verification. A failed post-upload
check may leave changed content; resolve and retry the same selection or use
rollback below.

After both phases succeed, check preserved historical routes automatically:

```bash
node scripts/maintenance.mjs public --snapshot "$PULSE_SNAPSHOT_DIR"
```

Then open these in your browser:

- `https://pulsecompute.io/`: layout and demo load.
- `https://pulsecompute.io/latest/`: navigate and search for a documented term.
- `https://pulsecompute.io/v1.0.0-beta.7/getting-started/`: historical docs load.
- `https://pulsecompute.io/v1.0.0-beta.1/`: oldest retained docs load.
- `https://pulsecompute.io/this-route-does-not-exist/`: real 404.

Record the two successful deployment run links in the cleanup PR. WEB-07 may now
merge after its own source/CLI/npm compatibility checks. The old writer remains
disabled. Product Markdown, installed CLI docs and supported exports stay in Pulse.

## Rollback if needed

Stop dispatching Website delivery and wait for every active/queued deployment
to finish or cancel; also keep the old Pulse writer disabled. In the same website
checkout with the seven named environment values loaded, run:

```bash
node scripts/maintenance.mjs rollback --snapshot "$PULSE_SNAPSHOT_DIR" --confirm-writers-stopped true
```

This authenticates the saved snapshot against the committed digest, checks
historical preservation, restores the original root/favicon/latest selection
with its metadata, purges and verifies the restored public pages. It leaves exact
versions, receipts, unrelated objects and new hashed assets intact. It requires
no npm verification, CI artifact, staging service or backup bucket.

If the CDN configuration caused the failure, reactivate the saved previous
Fastly service version and rerun the rollback command to purge/check again.
Do not re-enable the old writer while a website deployment can still run.
This command restores the initial migration snapshot; a later rollback to a
newer website release uses that release's retained successful Website checks
SHA through Website delivery while its artifact remains available.
