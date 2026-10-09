# B7-03: trusted-publisher and protected-environment handoff

Repository-only owner checklist, October 7, 2026. Entry point:
`release-readiness`; the documentation owner maintains this handoff and the
canonical setup guides. Source inspected: `latest` at
`621be9d5750f77d6540877ff3a5f87e1b4c86a2e`, tree
`5ccc03d6921df15d4a8c6a104418eb36765ffcb8`.

**Status: setup complete by owner attestation; actual OIDC publication pending.** B7-02 is
[complete](bootstrap.md#post-bootstrap-verification): all 20 names exist and
satisfy bootstrap policy. Those registry observations do not expose trusted
publishers, access/recovery controls or GitHub environment protection. This
task prepares the exact owner actions and receipt; it does not change settings,
dispatch a release or prove successful OIDC publication.

## Owner completion attestation

After B7-03, the release owner confirmed on October 7, 2026: “Yes everything is
setup.” The B7-06 readiness refresh records that direction as completion of this
setup handoff, covering the publisher/environment and credential checklist.
Private administrative settings were not independently inspected by the agent;
successful OIDC publication and provenance require the later exact-tag run.
The unchecked rows and pending fields below are the original reusable checklist
and receipt template, not reopened beta.7 setup blockers.

## One exact publisher identity

The release manifest and protected publish job already agree on:

| npm form field | Required value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `pulse-compute` |
| Repository | `pulse` |
| Workflow filename | `npm-publish.yml` (filename only) |
| Environment name | `npm-publish` (required for Pulse) |
| Allowed actions | Direct `npm publish` explicitly enabled |

The complete GitHub repository is `pulse-compute/pulse`; do not enter that
combined string into npm's repository-name field. The environment must not be
left blank. Current npm configurations allow staging by default; that does not
authorize direct publication. Pulse uses `npm publish --tag latest`, so separate
dist-tag-management permission is not required. Do not switch to staged
publication or broaden publisher identities for this ticket.

The publication candidate uses GitHub-hosted Ubuntu 24.04; audit/publish/verify
use `ubuntu-latest`, with Node `24.18.0`, npm `11.15.0` and pnpm `12.4.2` selected
by the release contract. Only the protected `publish` job requests
`id-token: write`; candidate/audit/verify jobs have no npm publication authority.
Source checks validate that wiring, not its private administrative settings.

## Owner actions

1. Open MCP's npm package Settings and its Trusted Publisher section. Create
   the identity above if absent, or inspect the matching existing configuration.
   Explicitly enable direct publication, save, then reopen to verify saved values.
2. Review the other 19 packages below for the same identity and direct action.
   Preserve valid configurations. Review any mismatch before correcting it;
   do not recreate all publishers or remove unrelated publishers wholesale.
3. In GitHub repository Settings → Environments → `npm-publish`, confirm
   tag-only deployment rules and an enabled human release-authority reviewer.
   A selected **Tag** rule must allow `v1.0.0-beta.7` and the reviewed release
   pattern. Branch rules or "Protected branches only" do not supply tag-only
   protection. Preserve valid restrictions; record the actual rule type/pattern,
   reviewer and current self-review/admin-bypass choices. Those choices are not
   new requirements to change this release's operating model.
4. Confirm the owner retains npm package/settings administration, GitHub
   environment access, human 2FA and recovery access. Revoke/remove the temporary
   bootstrap credential if one was used. Confirm no long-lived npm CI credential
   is supplied through organization/repository/environment settings; normal
   publication remains OIDC. Record credential removal status, never its value,
   a recovery code or an OIDC token.
5. Complete the dated receipt below. No test publication or release dispatch is
   needed for this preparation. The later exact-tag publish job records OIDC
   success and provenance after protected human approval.

## Complete package checklist

Names/order come from `release/pulse-release-manifest.json`. Each checked row
means the owner verified the saved identity **and direct-publication permission**;
it is not an OIDC success claim. All rows start pending, including the existing
19. Their beta.6 publication does not prove their current settings.

| Owner check | Package | Action |
| --- | --- | --- |
| [ ] | `@pulse-compute/runtime` | Confirm existing |
| [ ] | `@pulse-compute/pulse` | Confirm existing |
| [ ] | `@pulse-compute/cli` | Confirm existing |
| [ ] | `@pulse-compute/provider-fastly` | Confirm existing |
| [ ] | `@pulse-compute/grip` | Confirm existing |
| [ ] | `@pulse-compute/assets` | Confirm existing |
| [ ] | `@pulse-compute/crypto` | Confirm existing |
| [ ] | `@pulse-compute/jwt` | Confirm existing |
| [ ] | `@pulse-compute/entities` | Confirm existing |
| [ ] | `@pulse-compute/mcp` | Configure/confirm after B7-02 |
| [ ] | `@pulse-compute/s3` | Confirm existing |
| [ ] | `@pulse-compute/wasm-build-support` | Confirm existing |
| [ ] | `@pulse-compute/wasm-compiler` | Confirm existing |
| [ ] | `@pulse-compute/wasm-guest-link` | Confirm existing |
| [ ] | `@pulse-compute/wasm-contracts` | Confirm existing |
| [ ] | `@pulse-compute/wasm-host-runtime` | Confirm existing |
| [ ] | `@pulse-compute/wasm-library-kit` | Confirm existing |
| [ ] | `@pulse-compute/provider-node` | Confirm existing |
| [ ] | `@pulse-compute/wasm-runtime-core-as` | Confirm existing |
| [ ] | `@pulse-compute/wasm-schema-json` | Confirm existing |

## Owner settings receipt

Copy into the release handoff and retain the completed package checklist. Use
`pending`, `passed`, `failed` or `blocked`; an empty field stays pending. A saved
settings screenshot/link or a dated owner attestation is setup evidence. Keep
secret and recovery material out of the receipt.

```text
B7-03 settings review: pending
Reviewer / reviewed-at (timezone): pending
Reviewed source / manifest SHA-256: pending
All 20 saved identities + direct npm publish checked: pending
MCP configuration outcome / evidence: pending
Existing 19 outcome / evidence / reviewed corrections: pending
npm-publish environment tag rule type + pattern: pending
Human release-authority reviewer / protection evidence: pending
Existing self-review / admin-bypass choices: pending
Owner package/settings access + 2FA/recovery confirmed: pending
Temporary bootstrap credential revoked/removed (or not used): pending
No long-lived npm CI credential supplied: pending
Unresolved settings / next action: pending
OIDC publication: not-run; later protected exact-tag publish job
```

B7-03 closes when the owner-reviewed saved settings and receipt cover all 20
packages, the protected environment and credential cleanup. Update the readiness
ledger with that actual review, not a source-check result. Refresh registry
evidence within its 24-hour window for final publication. B7-04/05 preparation
can continue while this owner action is pending; B7-06 must not freeze with an
unresolved setup requirement. Do not run a seal just to complete this checklist.

## References

- [Canonical trusted-publishing procedure](../../maintainers/npm-publishing.md#trusted-publishing)
- [Repository environment setup](../../maintainers/repository-setup.md#7-configure-npm-trusted-publishing)
- [npm trusted-publisher fields and allowed actions](https://docs.npmjs.com/trusted-publishers/)
- [GitHub environment reviewers and tag rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
