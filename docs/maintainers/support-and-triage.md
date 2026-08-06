<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Support and triage

Pulse can launch quietly while still giving users a predictable way to report problems. The support posture favors high-signal evidence and bounded maintenance over an implied service-level agreement.

## Intake routes

Use the repository forms for:

- supported-behavior defects;
- documentation problems;
- scope or architecture proposals;
- usage questions and support requests.

Report suspected vulnerabilities privately through GitHub security advisories. Do not include credentials, proprietary source, private URLs, customer data, or exploitable details in a public issue.

## First response

A maintainer or Codex should establish:

1. release and package versions;
2. host operating system and Node version;
3. target provider;
4. the smallest reproducible project or fixture;
5. exact command and diagnostic code;
6. whether the behavior is documented as supported;
7. whether the report suggests a protected-boundary change.

Then classify the report as defect, hardening, documentation, evidence, scope expansion, architecture, or release.

## Quiet-launch posture

The Beta makes no response-time or compatibility guarantee beyond
its documented release contract. Normal maintenance priority is:

1. containment, secret exposure, artifact escape, or release-integrity failures;
2. regressions in supported examples and canonical CLI behavior;
3. incorrect diagnostics, packaging, provider realization, or documentation;
4. hardening and usability friction;
5. scope requests retained as evidence.

A popular request is not automatically a product decision. Repeated evidence should be summarized for the human maintainer, including the affected architectural boundary and the smallest coherent option.

## Patch posture

Codex may prepare a patch for an in-scope defect or hardening issue after reproduction. The patch should:

- repair the canonical owner;
- add the smallest contract evidence;
- preserve explicit rejection and host authority;
- update diagnostics and documentation when the user-visible contract changes;
- run the policy-selected portable checks;
- list dependency-bound checks still required;
- avoid unrelated cleanup.

Scope, architecture, and release proposals remain analysis until the human authority approves direction.

## Closing issues

Close an issue with one of four clear outcomes:

- fixed in a named release or commit;
- documented as expected Beta behavior;
- retained as evidence for a future decision;
- declined because it conflicts with a stated invariant.

Avoid vague “won't fix” responses. Explain the boundary and point to the
relevant preview-scope, concept, reference, or maintenance-policy page.
