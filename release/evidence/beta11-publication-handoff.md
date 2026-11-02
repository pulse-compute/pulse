# beta.11 publication handoff

**PR #591 is merged; npm publication has not started.** Main is `dbad9e9b553d87999ae35a68c2f94335c99b3acc`, with exactly the qualified tree `77e58f4f93bf3f90d1f3390423218bc6d8a20462`, qualified base `e69e4b6f1381a05bf0ee0b9b4c6385d2acefb20c` and second parent `3817f027cee36f9503d35420a775afdf639af568`.

The release owner authorized cutting beta.11 after the integrated review, full automated qualification and fresh live K4. Candidate-specific remaining provider limits are accepted and retained in [#572](https://github.com/pulse-compute/pulse/issues/572); no not-run result was changed to passing. #508 stays administratively open until publication and public package tests.

## Ready inputs

- Original accepted qualification source: `67c984d8dc223dd94d1146353534b12a89e0e50b`; [run 41301460387](https://github.com/pulse-compute/pulse/actions/runs/41301460387), artifact `13083118233`.
- Accepted ZIP SHA-256 `2de79c3f72776cda7ca2d575c7e69dfbc55e8e418523d1c11ae74911d1496324`. Original tarballs and receipts unchanged.
- Four PR workflows green. Exact source tree and both merge parents verified after merge. The raw-byte release-preparation check passed on main.
- [Live K4 passed](beta11-k4-live.md): IAD/LHR, 58 unique requests, three create/CAS schedules, zero retries, actual dropped-response uncertainty, cleanup passed.
- Annotated local tag `v1.0.0-beta.11`, object `b678e6f561326ec1ebbeed847511344f606329c2`, targets main `dbad9e9`.
- [Tag-only Git bundle](beta11-publication-handoff/beta11-release-tag.bundle), SHA-256 `2687ff7712a72968d859707a166ef6b2a240fba2be8445afd79f419365d1951a`; 245 bytes. The target main commit must already be present when importing this tag-only object.
- [Registry name audit](beta11-publication-handoff/npm-package-name-audit.json): all 20 names exist.
- [Local publication plan](beta11-publication-handoff/npm-publication-plan.json): ready; all 20 beta.11 versions were absent and selected for exact-tarball publication, with no integrity conflict.

These local read-only checks are preparatory evidence. The actual tag-dispatched workflow must still perform its fresh audit, authenticate the qualification/merge binding and produce the protected review packet.

## Execution blocker

The GitHub connector supports PR merge but exposes neither release-tag creation nor workflow dispatch. Local Git has no write credential; a dry-run push failed with `could not read Username for https://github.com: terminal prompts disabled`. The `gh` CLI is absent. No remote tag, workflow dispatch, package upload or protected publishing approval occurred.

Provide authenticated GitHub transport scoped to this repository with Contents and Actions write access. npm credentials are not needed; the existing workflow uses trusted OIDC publication.

## Resume without rebuilding or repacking

On an authenticated clean checkout of the exact main commit:

```sh
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git rev-parse HEAD
# Must be dbad9e9b553d87999ae35a68c2f94335c99b3acc
# Import the retained annotated tag only if it is absent locally:
git fetch /absolute/path/to/beta11-release-tag.bundle refs/tags/v1.0.0-beta.11:refs/tags/v1.0.0-beta.11
git cat-file -t refs/tags/v1.0.0-beta.11
git rev-parse refs/tags/v1.0.0-beta.11^{}
git push origin refs/tags/v1.0.0-beta.11
gh workflow run npm-publish.yml --ref v1.0.0-beta.11 -f release_tag=v1.0.0-beta.11 -f operation=publish -f run_smoke=true
```

Verify the tag is annotated and resolves to the exact accepted main commit; never force or replace a conflicting release tag. The publication workflow itself validates the tag and authenticates the original accepted qualification. Its fresh read-only audit and publication plan must pass before the owner approves the `npm-publish` protected environment. The agent must not approve its own protected gate.

After publication, the workflow verifies all 20 public registry integrities, configured dist-tags, clean exact-version CLI install/init/doctor/test/build, and the published context-app smoke including cleanup. Retain terminal reports; close #508 only after these pass. Reconcile main back into latest through the ordinary reviewed path.

## Tag-helper defect retained separately

[Issue #594](https://github.com/pulse-compute/pulse/issues/594) records the convenience helper's `.trim()` bug. It changes historical file bytes before hashing and rejects valid newline-terminated metadata. The exact raw historical digest matches the manifest, and `release-pr-check.cjs --base v1.0.0-beta.10 --head HEAD` passed. All clean-main, source/tree, version/history and no-existing-tag checks were retained before ordinary Git created the annotated local tag. No source repair or changed candidate is hidden in this handoff.
