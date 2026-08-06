# Contributing to Pulse

Thank you for helping harden Pulse. Start with the [contributor documentation](./docs/contributing/README.md) and [maintainer governance](./docs/maintainers/README.md).

Before opening a pull request:

1. classify the change using the [scope policy](./docs/maintainers/scope-policy.md);
2. keep the machine-readable declaration in the pull-request body;
3. edit canonical sources rather than generated outputs;
4. run `npm run maintainer:check`;
5. run the portable checks selected by `node scripts/maintainer-scope.cjs`;
6. report dependency-bound validation honestly.

Routine defect, hardening, documentation, and evidence patches are welcome. New public syntax, effects, capabilities, providers, lowerer trust, package exports, compatibility promises, or release behavior require an explicit architecture or scope decision before implementation.

All merges and releases remain human-approved.
