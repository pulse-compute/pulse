## Summary

Describe the problem, the smallest coherent change, and why it belongs in the current alpha.

## Evidence

Link the issue or include the reproduction, contract fixture, diagnostic, or documentation source that demonstrates the change.

## Validation

List the commands run and their results. Separate portable checks from dependency-bound checks that remain for the release owner.

## Scope declaration

Keep exactly one declaration block and replace every `choose-one` value. See [`docs/governance/scope-policy.md`](../docs/governance/scope-policy.md).

<!-- pulse-maintainer-declaration:start -->
Change class: choose-one
Scope: choose-one
Protected boundaries: none
Human decision: choose-one
<!-- pulse-maintainer-declaration:end -->

Allowed change classes: `defect`, `hardening`, `documentation`, `evidence`, `scope-expansion`, `architecture`, `release`.

Use the class's matching scope: `inside-current-alpha`, `evidence-only`, `scope-expansion`, `architecture-change`, or `release-change`. List comma-separated boundary IDs from the generated maintenance policy, or `none`. Set human decision to `required` only for an approved scope, architecture, or release decision.

## Maintainer checklist

- [ ] I changed canonical sources rather than generated copies.
- [ ] I added or updated the smallest relevant contract evidence.
- [ ] I ran `npm run maintainer:check`.
- [ ] I ran the portable checks selected by the scope report.
- [ ] I named dependency-bound checks that still need the restored release dependency bundle.
- [ ] No secret, credential, private endpoint, or proprietary fixture is included.
