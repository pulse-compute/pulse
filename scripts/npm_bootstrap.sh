#!/usr/bin/env bash
set -euo pipefail

REGISTRY="https://registry.npmjs.org/"
BOOTSTRAP_VERSION="0.0.0"
BOOTSTRAP_TAG="bootstrap"

fail() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  echo "Usage: scripts/npm_bootstrap.sh <package-name>" >&2
}

[[ $# -eq 1 ]] || {
  usage
  exit 64
}

PACKAGE_NAME="$1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for command in node npm; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
[[ -f "$ROOT/LICENSE" && -f "$ROOT/NOTICE" ]] \
  || fail "repository LICENSE and NOTICE files are required"

node - "$PACKAGE_NAME" <<'NODE'
const name = process.argv[2];
const segment = '[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?';
const pattern = new RegExp(`^(?:${segment}|@${segment}/${segment})$`);
if (
  typeof name !== 'string'
  || name !== name.toLowerCase()
  || Buffer.byteLength(name, 'utf8') > 214
  || !pattern.test(name)
) {
  console.error(`error: invalid npm package name: ${JSON.stringify(name)}`);
  process.exit(1);
}
NODE

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/pulse-npm-bootstrap.XXXXXX")"
cleanup() {
  rm -rf -- "$STAGE"
}
trap cleanup EXIT

cp "$ROOT/LICENSE" "$STAGE/LICENSE"
cp "$ROOT/NOTICE" "$STAGE/NOTICE"

node - "$STAGE" "$PACKAGE_NAME" "$BOOTSTRAP_VERSION" "$BOOTSTRAP_TAG" "$REGISTRY" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [stage, name, version, tag, registry] = process.argv.slice(2);
const manifest = {
  name,
  version,
  description: `Inert bootstrap placeholder for ${name}.`,
  license: 'Apache-2.0',
  files: ['README.md', 'LICENSE', 'NOTICE'],
  publishConfig: {
    access: 'public',
    registry,
    tag
  }
};
const readme = [
  `# ${name}`,
  '',
  '> Bootstrap placeholder — no runtime or API.',
  '',
  `This inert ${version} package reserves the npm name for future Pulse releases.`,
  ''
].join('\n');

fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(stage, 'README.md'), readme);
NODE

echo "==> Inspecting inert ${PACKAGE_NAME}@${BOOTSTRAP_VERSION} package"
npm pack "$STAGE" \
  --dry-run \
  --json \
  --ignore-scripts \
  --registry "$REGISTRY"

echo "==> Publishing ${PACKAGE_NAME}@${BOOTSTRAP_VERSION} with dist-tag ${BOOTSTRAP_TAG}"
npm publish "$STAGE" \
  --access public \
  --tag "$BOOTSTRAP_TAG" \
  --ignore-scripts \
  --registry "$REGISTRY"

DIST_TAGS="$(npm view "$PACKAGE_NAME" dist-tags --json --registry "$REGISTRY")"
node - "$DIST_TAGS" "$BOOTSTRAP_VERSION" "$BOOTSTRAP_TAG" <<'NODE'
const [raw, version, tag] = process.argv.slice(2);
let tags;
try { tags = JSON.parse(raw); }
catch (error) {
  console.error(`error: npm returned invalid dist-tag JSON: ${error.message}`);
  process.exit(1);
}
if (
  !tags
  || tags[tag] !== version
  || (Object.hasOwn(tags, 'latest') && tags.latest !== version)
) {
  console.error(`error: bootstrap dist-tag verification failed: ${JSON.stringify(tags)}`);
  console.error('error: a human release authority must remediate npm dist-tags, then rerun npm run release:audit-npm');
  process.exit(1);
}
NODE

echo "==> Verified ${PACKAGE_NAME}@${BOOTSTRAP_VERSION} under ${BOOTSTRAP_TAG}; latest is absent or remains on the inert bootstrap"
