<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Maintainer documentation

This index is the entry point for repository governance, release operations,
publication, deployment, and evidence procedures. These are maintainer
artifacts, not application-author reference material.

## Governance and support

- [Maintainer charter](./maintainer-charter.md) — division of responsibility between Codex and the human architecture/release authority.
- [Scope policy](./scope-policy.md) — change classes, protected boundaries, and the pull-request declaration.
- [Codex maintainer operation](./codex-maintainer.md) — how native review and the manual policy review workflow are used safely.
- [Repository setup](./repository-setup.md) — GitHub team, ruleset, protected environments, action allowlist, labels, Codex, npm, Object Storage, and Fastly configuration that cannot be committed as files.
- [Support and triage](./support-and-triage.md) — issue intake, response posture, escalation, and quiet-launch operating rules.
- [Generated maintenance policy](./maintenance-policy.md) — exact classes, boundaries, checks, action pins, environments, and forms.

## Release and publication

- [Release manifest and package policy](./release-manifest.md) — synchronized version, package set, support tiers, and target inventory.
- [Testing Pulse](./testing.md) — focused tasks, profiles, dependency restoration, and evidence expectations.
- [Release packages and clean-consumer acceptance](./release-acceptance.md) — package construction, packed-consumer checks, and seal evidence.
- [npm publishing](./npm-publishing.md) — sealed tarballs, trusted publishing, dependency-safe retries, and registry verification.

## Documentation operations

- [Documentation system and release workflow](./documentation-system.md) — canonical sources, synchronization, ownership, and release snapshots.
- [Public site and documentation presentation](./public-site.md) — editorial manifest, navigation, rendering, accessibility, and site validation.
- [Documentation versions](./documentation-versioning.md) — exact snapshots, the moving alias, search, and installed copies.
- [Documentation deployment](./documentation-deployment.md) — immutable Object Storage releases, root/latest promotion, and Fastly VCL delivery.

## Protected implementation boundaries

- [Public plugin API readiness](./plugin-readiness.md) — the explicit boundary around first-party lowerers and provider bootstrap.
- [Contributor extension guides](../contributing/) — first-party package lowerers, providers, and Pulse-aware package authoring.

## Authority model

Pulse uses a resident-maintainer control plane to keep the public Beta
supportable without transferring product authority to automation. The control
plane combines machine-readable scope policy, deterministic path
classification, repository-local Codex instructions, GitHub ownership, and
human approval.

The system is deliberately asymmetric:

```text
repository invariants and deterministic checks
                    ↓
       Codex analysis and patch preparation
                    ↓
        human architecture and release authority
```

Codex is a resident maintainer, not a repository principal. It may inspect, classify, reproduce, review, document, and prepare bounded changes. It may not merge, publish, change repository settings, or approve a change to a protected boundary.
