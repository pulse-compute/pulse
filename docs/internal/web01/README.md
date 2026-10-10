# WEB-01 — Renderer proof and framework decision

Status: proof complete; select Astro with Starlight for WEB-02 onward, pending
human review of the implementation PR. Reviewed: 2026-10-09.

Entry point: `documentation-current`. Human direction: proceed with WEB-01,
keep Pulse PR #248 open, and stack any Pulse additions above it. This packet
adds repository-only evidence and the local proof procedure. It changes no
product source, active release workflow, package export or deployment authority.

The [WEB-00 contract](../web00/README.md) remains the migration boundary. The
implementation lives in [pulse-compute/website](https://github.com/pulse-compute/website),
branch `feat/web-01-renderer-proof`, above merged website PR #1. This Pulse
packet is based on `docs/web-00-website-migration` at
`8d43f1679529772c4387924f7bfc2e85958a00be`; it does not retarget or modify #248.

## Decision and observed output

Use Astro 7.3.8 with Starlight 0.42.6 and `@astrojs/markdown-remark` 7.3.2,
all pinned with the website's npm lockfile. Astro's
[supported Unified processor](https://docs.astro.build/en/guides/markdown-content/#setting-up-a-markdown-processor)
provides the Markdown pipeline; Starlight's
[custom pages](https://starlight.astro.build/guides/pages/#custom-pages) allow
the independent v5 hero beside the documentation collection.

The five ordinary Markdown files render without editing Pulse, adding product
frontmatter, converting to MDX, running the Pulse workspace or porting the old
renderer. Website-generated frontmatter supplies the first source heading as
the page title and a commit-pinned source link. One small Markdown plugin keeps
legacy heading IDs, duplicate suffixes and explicit HTML anchors, removes the
duplicate visible source h1 while retaining its ID, and resolves proof links.
There are **zero Starlight component overrides**. The theme uses supported
CSS variables; the landing is a separate Astro page using the supplied v5
slate/mint styles, static rail and Inspect/Doctor/Report sequence.

| Canonical source at beta.7 | Proof URL | Captured IDs retained |
| --- | --- | ---: |
| `docs/README.md` | `/latest/` | 7 |
| `docs/getting-started.md` | `/latest/getting-started/` | 9 |
| `docs/reference/cli.md` | `/latest/reference/cli/` | 75 |
| `API.md` | `/latest/api/` | 24 |
| `examples/01-hello-json/README.md` | `/latest/examples/01-hello-json/` | 6 |

All 121 content IDs match the [published WEB-00 inventory](../web00/published-beta7.json)
in order, with no duplicate DOM IDs. The five-page fixture in the website is
an explicitly bound subset of that inventory, not a second product contract.
All fenced blocks retain their source text, including indentation and blank
lines. The labeled `/proof/markdown/` synthetic fixture additionally checks
three-level lists, a table, inline code/links, escaped fenced code, duplicate
headings, explicit heading IDs and standalone legacy `name` anchors. Its
explicit heading ID is also used by Starlight's table of contents.

The static artifact contains eight HTML files: the hero, five documentation
pages, the fixture and a real 404 page. The check validates 521 local links and
assets, including cross-page fragments. It emits no `/v<version>/` tree.
Unselected documentation links point at published exact beta.7 URLs; non-hosted
source links point at the full source commit. Local validation does not verify
the bytes or availability of production-hosted archives.

## Source boundary

The website's `source-lock.json` remains published `v1.0.0-beta.7` at
`be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb`. The bounded preparation script
checks checkout HEAD, tag resolution, tracked cleanliness, manifest version and
the five baseline source hashes before replacing ignored output. A wrong source
checkout was rejected before changing existing derived output. No source scripts,
generators, package installation or lifecycle hooks execute during preparation.

`src/content/docs/`, `.pulse-content/`, `.astro/` and `dist/` are ignored,
disposable outputs. WEB-01 explicitly locates Astro's content cache under
`.astro/cache/` and clears it during preparation so a changed compatibility
plugin cannot leave stale rendered content when Markdown bytes stay unchanged.
WEB-02 owns the real importer and source data contract; this scaffold selects
only five files and deliberately cannot advance to another release without
replacing its bound fixture.

## Reproduce locally

Use Node.js 22.12+ (tested with 24.19.0) and npm. In a website checkout,
prepare a separate source checkout with the published tag available:

```bash
git clone --no-checkout https://github.com/pulse-compute/pulse.git .pulse-source
git -C .pulse-source checkout --detach be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb
npm ci
npm run build
npm run check
npm test
npm run verify:proof
npx playwright install chromium
npm run test:browser
npm run preview
```

Alternatively set `PULSE_SOURCE_DIR` to an existing clean worktree at the lock's
exact commit for `dev`, `build` and `check`. Preparation reads those bytes only.
Do not point it at integration `latest`: its version alone does not establish
published identity. Open the local preview reported by Astro to inspect it.

The browser checker serves the built files through Playwright interception at
the reserved `https://proof.invalid` origin, with external requests blocked.
It requires no server, session or production access. It checks all seven routes
at 1440, 768, 390 and 320 pixels, one visible h1, document overflow, the hero CTA,
keyboard skip link and mobile navigation. It also checks mobile no-JavaScript
reading/navigation and missing exact-version 404 behavior. Set
`PULSE_SCREENSHOTS=1` to retain ignored screenshots under `.pulse-site-preview/`.

This environment used Chromium 134.0.6998.35 via
`PULSE_BROWSER_EXECUTABLE` and `PULSE_BROWSER_SINGLE_PROCESS=1`: the default
browser download/regular Chrome launch was unavailable here. The supported
default command uses Playwright's installed Chromium. Screenshots were inspected
at desktop and mobile sizes. Cross-browser coverage remains a later frontend
validation task; no production hosting or CDN behavior is inferred from this test.

## Validation and handoff

Website checks passed: clean preparation/build, Astro type check, three focused
link tests, rendered route/ID/code/structure/asset checks and browser checks.
Astro type check reported zero errors, warnings or hints. The static proof uses
Starlight's default English/404 fallbacks and skips a sitemap without a deployed
`site` origin; those build notices do not certify deployment readiness.

Pulse packet checks also passed with Node 24.19.0 and its restored, lockfile-pinned
pnpm 12.4.2 workspace (lifecycle scripts disabled): `docs:sync` produced no
tracked generated changes; `maintainer:check`, `docs:check`,
`documentation-release.cjs` and the repository-only source-exclusion test passed.
The existing renderer still validates 82 current pages across six releases and
20,298 local links. Those are Pulse contract checks, separate from the website
proof above. No compiler suite or release qualification was needed for this
internal packet.

Development retries corrected a CSS extraction boundary, inline HTML anchor
recognition and Astro content-cache location. Rendered-code checks account for
Expressive Code's line wrappers without changing content. Browser assertions
use Starlight's native popover state, including Escape and no-JavaScript use.
The passing result follows these fixes; earlier failed attempts are not gates.

WEB-02 should replace the bounded preparation/link adapter with the approved
read-only importer and Pulse data contract, retain these five-page regression
oracles, and extend parity to the full eligible subset. WEB-03 owns the remaining
v5 sections/report/compare fixtures and assets; WEB-04 owns complete docs UX,
search, version selection and source-retirement mappings. WEB-05/06 own CI,
artifacts, staging, archives, protected delivery and cutover. No production merge,
deployment, source-pin promotion or archive rewriting is authorized by this proof.
