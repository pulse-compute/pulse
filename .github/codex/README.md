# Codex maintainer assets

This directory contains the authored prompt and generated output schema used by the manual **Codex maintainer review** workflow.

- Edit `release/maintenance-policy.json`, not `schemas/maintainer-review.schema.json`.
- Synchronize generated policy surfaces with `npm run maintainer:sync`.
- The review workflow is manually dispatched from the default branch and uses the protected `codex-maintainer` environment.
- Codex runs from a nested Git checkout fixed at the trusted pull-request base. Proposed source, workflow, policy, prompt, schema, and `AGENTS.md` files remain untrusted review material available through local Git refs; the outer proposed working tree is removed before Codex starts.
- The workflow uses a read-only permission profile and a separate posting job that receives neither the checkout nor the OpenAI secret.
- Native Codex review remains separately configurable in Codex settings and follows the repository's hierarchical `AGENTS.md` files.
