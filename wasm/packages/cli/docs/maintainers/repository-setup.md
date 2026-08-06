<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Repository setup

Files in this repository define the desired control plane, but GitHub teams, rulesets, environments, secrets, connected services, security settings, and production delivery configuration live outside Git. A repository owner must apply these steps after cloning or transferring the repository.

## 1. Create the maintainer team

Create a visible organization team with the slug:

```text
pulse-compute/pulse-maintainers
```

Give the team write access to the repository and add the human architecture and release authority. The generated `.github/CODEOWNERS` file assigns protected areas to `@pulse-compute/pulse-maintainers`; GitHub cannot request that team until it exists, is visible, and has repository access.

## 2. Restrict Actions and synchronize labels

In the repository's Actions settings, allow only GitHub-authored actions and the explicitly required external action, or use an equivalent organization allowlist. Every checked-in action reference is pinned to a reviewed full commit SHA recorded in `release/maintenance-policy.json`.

Run the manual **Maintainer labels** workflow from the default branch. It creates or updates the labels generated in `.github/labels.yml` from `release/maintenance-policy.json`.

Labels classify intake and review state. They do not authorize implementation or merge.

## 3. Create a branch ruleset for `main`

Create a ruleset targeting the default branch and require pull requests. Recommended settings are:

- at least one approving review;
- approval from code owners;
- dismissal of stale approvals after new commits;
- conversation resolution;
- blocked force pushes and deletion;
- no Codex, Actions-token, or automation-account bypass; and
- these exact status checks from `release/maintenance-policy.json`:
  - `Maintainer scope / scope`
  - `Repository validation / maintenance`
  - `Repository validation / node-floor`
  - `Repository validation / portable`
  - `Documentation / build`

Keep workflow, CODEOWNERS, `AGENTS.md`, release-policy, and governance changes under CODEOWNER review. The deterministic scope workflow executes the classifier from an archive of the pull request's trusted base commit rather than running the proposed classifier.

The portable validation job installs the lockfile-pinned workspace graph with lifecycle scripts disabled, builds the workspace outputs needed by tests, and runs the unit, native, JavaScript, and conformance profiles. It does not replace provider, CLI, package, clean-consumer, or external-host evidence in the aggregate release seal.

## 4. Create the protected Codex environment

Create a GitHub Actions environment named:

```text
codex-maintainer
```

Configure it to allow deployment only from the default branch. When supported by the repository plan and desired operating model, require a human reviewer before the job starts.

Add this environment secret:

```text
OPENAI_API_KEY
```

Do not add the key as a broadly available repository secret. GitHub releases an environment secret to a job only after the configured environment protection rules pass.

The manual **Codex maintainer review** workflow also checks that it was dispatched from the default branch. It checks out the pull-request merge ref only to obtain the Git objects, then runs Codex from a separate nested checkout fixed at the trusted base commit. The proposed head is available through local review refs and cannot replace the `AGENTS.md`, policy, prompt, schema, or classifier governing that run. Before Codex starts, the workflow removes the outer proposed working tree so only the trusted nested checkout remains in the Actions workspace.

## 5. Configure Codex

Connect the repository in Codex cloud. Enable native code review when useful and choose whether review should be automatic or explicitly requested. Native review remains advisory and does not replace the repository's required checks.

For the policy-specific review, manually dispatch **Codex maintainer review** from the default branch and supply a pull-request number. The workflow uses the `codex-maintainer` environment and the `OPENAI_API_KEY` environment secret. It does not run on `pull_request_target`, forks, issue comments, pushes, or arbitrary untrusted triggers.

## 6. Enable security intake

Enable private vulnerability reporting and GitHub security advisories. The public security page directs reporters to the repository's private advisory form rather than a normal issue.

## 7. Configure npm trusted publishing

Create a protected GitHub Actions environment named:

```text
npm-publish
```

Allow deployment only from release tags and require a human release-authority reviewer. Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN` to the repository or environment.

For every package in `release/pulse-release-manifest.json`, first confirm that the package name exists under the intended npm owner. Missing names need a one-time human 2FA-protected bootstrap publication. Then configure npm trusted publishing with the exact repository, `npm-publish.yml` workflow filename, and `npm-publish` environment.

Select the exact `v<releaseVersion>` tag as the workflow ref, then run **npm
publication** manually. Confirm that the protected job receives OIDC only after
approval, the registry integrity report covers every package in the sealed
release catalog, the configured dist-tags point to the synchronized version,
and the clean published-CLI smoke test passes.

## 8. Configure documentation delivery

Create a protected GitHub Actions environment named:

```text
documentation-production
```

Allow deployment only from release tags and require a human release/infrastructure reviewer. Add bucket-limited read/write Object Storage credentials as environment secrets:

```text
FASTLY_OBJECT_STORAGE_ACCESS_KEY_ID
FASTLY_OBJECT_STORAGE_SECRET_ACCESS_KEY
```

Add these environment variables:

```text
FASTLY_OBJECT_STORAGE_BUCKET
FASTLY_OBJECT_STORAGE_REGION
FASTLY_OBJECT_STORAGE_ENDPOINT
PULSE_DOCUMENTATION_ORIGIN
PULSE_DOCUMENTATION_BASE_PATH
```

Create a separate bucket-limited read-only key for the Fastly VCL private origin. Do not expose that key to GitHub Actions, and do not place the read/write deployment key in VCL.

Install the checked-in snippets under `infra/fastly/documentation/` in a non-production Fastly service version, configure the regional Object Storage backend and protected origin credentials, then verify GET, HEAD, directory indexes, exact-version caching, root/latest caching, branded 404s, and security headers before manual activation.

The **Documentation** workflow now validates pull requests and `main` and uploads preview artifacts only. Select the exact release tag as the workflow ref, then manually dispatch **Documentation deployment**. It uploads and verifies immutable exact-version objects, verifies the matching npm catalog, promotes root/latest, and verifies the final route through Fastly. Before activation, change the release-owned documentation origin from the old Pages hostname to the final Fastly-served origin; the workflow rejects a mismatch.

## 9. Verify the installation

Open a test pull request that changes one documentation file. Keep the declaration block and set:

```text
Change class: documentation
Scope: inside-developer-preview
Protected boundaries: none
Human decision: not-required
```

Confirm that all four required checks report. Then change a control-plane file and confirm that CODEOWNER review is requested and the scope report names `maintenance-control-plane`.

Finally, manually run the Codex maintainer review from the default branch against the test pull request. Confirm that the environment protection activates, that one marked structured comment is created or updated, and that no secret is exposed to the posting job.

Repository settings are not validated from a source archive. Record completion in the release checklist or repository administration log.
