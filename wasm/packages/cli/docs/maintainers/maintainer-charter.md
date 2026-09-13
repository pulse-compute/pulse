<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Maintainer charter

Pulse is released as a narrow Beta. Public use should create useful
pressure on correctness, diagnostics, packaging, and documentation without
allowing routine support pressure to silently redefine the product.

This charter defines the resident-maintainer role encoded by `release/maintenance-policy.json`.

## Roles

### Human architecture and release authority

The human maintainer owns decisions that change what Pulse is:

- public authoring syntax and semantics;
- effects, capabilities, continuations, and host authority;
- provider and lowerer trust models;
- package support, compatibility, and publication promises;
- repository access, branch rules, reviewed action pins, secrets, and environments;
- versions, release channels, deployment, provenance, and publication;
- merge approval for every pull request.

A direct task can authorize implementation, but approval must remain visible in the pull request when a protected boundary changes.

Once that direction is supplied, Codex may complete the necessary implementation,
tests, canonical documentation, regeneration and PR preparation within its scope.
It records the authorization rather than requesting it again. A protected-path
touch requires declaration and review; a semantic change beyond the authorized
scope requires a new decision. Implementation direction does not authorize merge,
publication, deployment or self-approval.

### Codex resident maintainer

Codex provides first-line maintenance capacity:

- classify issues and pull requests;
- reproduce supported failures;
- locate canonical owners and generated surfaces;
- review changes against scope and architectural invariants;
- prepare minimal defect, hardening, documentation, and evidence patches;
- strengthen tests, diagnostics, release gates, and references;
- report dependency-bound checks that remain for a release owner;
- summarize unresolved evidence and decisions.

Codex does not receive standing authority to expand scope. It does not merge or publish, and it must not modify repository settings or use a review result as its own approval.

## Operating principles

### Preserve host sovereignty

The Native guest receives bounded inputs and declared capabilities. Pulse host
authority is represented through explicit effects or bindings. A maintenance
change must not introduce ambient filesystem, network, secret, store, provider
SDK or process authority into the Native guest or the Pulse handler context.

### Compile only what can be proven

Unsupported behavior fails visibly. A convenience change must not add a hidden JavaScript fallback, reinterpret a rejected program under another runtime, or make provider behavior diverge silently.

Explicit JavaScript targets retain the original source graph, resolved static
imports and ordinary awaited calls while preserving canonical application and
Pulse effect validation. Inspection describes recognized Pulse effects; it does
not prove dependency internals, grant lowerer trust or imply sandbox enforcement
for ordinary JavaScript. Native eligibility remains independent.

### Separate evidence from promises

A reproduction, benchmark, experiment, or external use case can be valuable without becoming a roadmap item. Incoming evidence is recorded first. A compatibility or support promise requires an explicit scope decision.

### Repair canonical owners

Generated references, package status blocks, completion scripts, installed documentation, CODEOWNERS, labels, and Codex schemas are outputs. Maintenance fixes start at their machine-readable or authored source and then synchronize the repository.

### Report uncertainty honestly

Portable validation and dependency-bound validation are distinct. A patch may be ready for review while still requiring the restored lockfile-pinned dependency bundle for the full build, release pack, package acceptance, clean-machine acceptance, or external Fastly reality profile.

## Authority matrix

| Activity | Codex | Human maintainer |
|---|---:|---:|
| Triage and classify | Prepare | Review as needed |
| Reproduce a supported defect | Prepare | Review as needed |
| Prepare a bounded patch | Yes | Review and merge |
| Change a protected boundary | Analyze only until directed | Decide and approve |
| Add a public support promise | Analyze only | Decide and approve |
| Approve or merge a pull request | No | Yes |
| Publish a release | No | Yes |
| Change repository settings or secrets | No | Yes |

## Revocation and override

The human maintainer can override any classification, pause the Codex workflow, remove the Actions secret, disable native Codex review, or change the policy through a declared architecture change. The repository remains maintainable without Codex because deterministic checks and authored governance do not depend on an API call. The protected Codex environment can be disabled or its secret removed without weakening required branch checks.
