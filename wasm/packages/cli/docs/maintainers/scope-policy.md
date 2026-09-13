<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Scope policy

The maintenance control plane separates routine work from product decisions. The exact catalog is generated in the [maintenance policy reference](./maintenance-policy.md); this page explains how to use it.

## Classify the intent

Every issue and pull request begins with one change class:

- **Defect** — documented or tested supported behavior is broken.
- **Hardening** — reliability, security, performance, diagnostics, or evidence improves without widening behavior.
- **Documentation** — explanation, examples, generated references, or presentation changes only.
- **Evidence** — a reproduction, fixture, benchmark, or experiment records information without creating a promise.
- **Scope expansion** — new syntax, capability, provider, effect, public export, or compatibility promise.
- **Architecture** — a trust boundary, execution contract, ownership rule, or governance mechanism changes.
- **Release** — publication, package composition, version, channel, deployment, signing, or provenance changes.

The first four classes can normally move to implementation and human review. The last three require a separate human decision before implementation is treated as approved direction.

A direct human task can supply that decision. Record its scope in the PR and
continue the necessary implementation, tests, canonical documentation,
regeneration and PR preparation. Do not ask again for the same direction.
New semantics or authority outside that scope still require a new decision;
implementation approval does not authorize merge, publication or deployment.

## Declare affected boundaries

Path rules conservatively infer protected boundaries, including the public API, effects and capabilities, continuations, lowerer trust, provider registry, configuration contract, compatibility surface, package publication, maintenance control plane, and release authority.

A path match does not claim that every edit changes the contract. It requires the pull request to name the boundary so reviewers can distinguish a mechanical edit from a semantic one.

## Pull-request declaration

Every pull request keeps this comment in its body:

```text
<!-- pulse-maintainer-declaration:start -->
Change class: defect
Scope: inside-developer-preview
Protected boundaries: none
Human decision: not-required
<!-- pulse-maintainer-declaration:end -->
```

Use comma-separated boundary IDs, or `none`. Use `required` when scope, architecture, or release authority needs an explicit decision.

`Human decision: required` identifies the decision authority even when the human
has already supplied direction. Keep the field accurate and describe the supplied
direction and any outstanding question in prose. The classifier does not verify
or grant approval. A protected-path match alone does not require this field to be
`required` for a defect that preserves the existing contract.

The `Maintainer scope / scope` check compares the declaration with changed paths. It has three outcomes:

- **pass** — the declaration is present and consistent with the conservative path inference;
- **decision-required** — the declaration is consistent and a separate human decision is correctly exposed;
- **fail** — the declaration is missing, uses unknown values, omits inferred boundaries, or contradicts the required decision state.

A decision-required result is not an agent approval or denial. Branch rules and CODEOWNER review remain the authority gate.

## Update current contracts

For each protected boundary, the maintenance policy records whether an approved
architecture or release change requires a current contract update. When it
does, edit the canonical present-tense architecture, concept, contributor,
governance, or release owner and update its executable evidence. Do not add a
chronological decision file instead of repairing current truth.

The [current architecture contracts](../architecture/current-contracts.md)
provide the ownership map. Git history and sealed checkpoints preserve the
superseded state.

## Select validation

The classifier returns required checks from the path policy. Portable checks can run in a source snapshot without the complete release dependency bundle. Dependency-bound checks remain mandatory before publication when their affected contract is touched.

Run the classifier locally with a pull-request body saved to a file:

```bash
node scripts/maintainer-scope.cjs \
  --base <actual-pr-base-ref> \
  --head HEAD \
  --declaration-file /tmp/pulse-pr-body.md \
  --check
```

Run the control-plane validation independently:

```bash
npm run maintainer:check
```

## Scope requests are evidence first

A request for a new provider, npm compatibility, streaming primitive, lowerer
API, agent facility, or host capability is not rejected merely because it is
outside the Beta. It is labeled and retained as evidence.
Implementation begins only when the human authority chooses the product and
architectural direction.
