# Pulse support

Pulse is a public Beta maintained through GitHub issues without a
response-time guarantee.

Use the issue chooser for supported-behavior defects, documentation problems, scope proposals, and usage questions. Include exact package versions, target provider, command, diagnostic code, and a minimal reproducible project when possible.

## Check your installed release

Run `pulse docs --json` with your project's installed CLI to find its version
and installed documentation paths. Match that version to the affected package
versions; include all exact versions in your report if they differ.

Use the matching exact-version links in that installed documentation. If the
hosted version is unavailable, find `v<installed-version>` in the repository's
[release tags](https://github.com/pulse-compute/pulse/tags) and read
`docs/preview-scope.md` and `API.md` at that tag. The installed CLI also ships
its `docs/` Markdown hierarchy and `API.md` for offline use. A website's
`latest` alias and this repository's development branch may describe different
versions; neither establishes support in an older installed package.

For current development, read [Beta scope](./docs/preview-scope.md) and the
[canonical outbound fetch contract](./API.md#ctxfetch). Outbound fetch methods
are separate from inbound routing and automatic OPTIONS behavior. Read
[Support and triage](./docs/maintainers/support-and-triage.md) for the
maintenance posture.

Do not report vulnerabilities or include secrets in a public issue. Follow [SECURITY.md](./SECURITY.md) instead.
