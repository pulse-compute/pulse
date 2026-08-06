# Immutable documentation site archives

This directory stores exact hosted documentation subtrees for releases that are no longer current.

Before bumping `release/pulse-release-manifest.json`, run:

```bash
pnpm docs:site -- --snapshot
```

The command writes `release/documentation-site-archives/v<current-version>/` from the validated current site. Commit that directory without editing it, retain the old entry in `release/documentation-versions.json`, and then generate the new release.

The site builder requires one valid archive for every non-current versions-manifest entry. Each archive is self-contained and includes its HTML, search index, public assets, release/version/editorial manifests, shared presentation assets, and `site-version-manifest.json`. The moving root product homepage is not archived as a root route; it is regenerated from the current release while using that release’s exact-version asset subtree. Existing archives are immutable release artifacts; `--force` is reserved for correcting an archive before it has been published.
