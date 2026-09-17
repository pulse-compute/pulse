#!/usr/bin/env bash
# Restore the current Pulse workspace from a Docker-exported, store-only
# dependency bundle without registry access. Workspace links are reconstructed
# from the current lockfile.
#
# Usage:
#   ./restore_pulsewasm_dependencies_portable.sh [--verify-only] bundle.tar.zst
#
# Optional env:
#   EXPECTED_DISTRIBUTION=debian-trixie
set -euo pipefail

fail() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }
usage() {
  cat <<'USAGE'
Usage: ./restore_pulsewasm_dependencies_portable.sh [--verify-only] <dependency-bundle.tar.zst>

Validates a pulse.dependency-bundle.v5 archive against the current lockfile and
runtime. By default it restores the lockfile-pinned workspace without registry
or Corepack network access. Run `npm run release:seal -- --skip-install` after
restoration to validate the current product.

Options:
  --verify-only  Validate archive safety, manifest identity, platform, Node,
                 pnpm, AssemblyScript, json-as, xjb-as, and lockfile without
                 modifying the repo.
  -h, --help     Show this help.
USAGE
}

VERIFY_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) fail "unknown option: $1" ;;
    *) break ;;
  esac
  shift
done

BUNDLE="${1:-}"
[[ $# -eq 1 && -n "$BUNDLE" && -f "$BUNDLE" ]] \
  || fail "usage: $0 [--verify-only] /path/to/pulse-wasm-deps-...tar.zst"
[[ -f package.json && -f pnpm-lock.yaml && -f wasm/package.json && -f wasm/packages/compiler/package.json ]] \
  || fail "run from the repository root"
for command in node tar zstd; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done

EXPECTED_DISTRIBUTION="${EXPECTED_DISTRIBUTION:-debian-trixie}"

ROOT="$(pwd)"
BUNDLE="$(node -e 'const p=require("node:path"); console.log(p.resolve(process.argv[1]))' "$BUNDLE")"
PNPM_EXPECTED="$(node -p "require('./release/pulse-release-manifest.json').publication.pnpmVersion")"
PNPM_DEVELOPMENT_RANGE="$(node -p "require('./release/pulse-release-manifest.json').publication.pnpmDevelopmentRange")"
ROOT_PNPM_RANGE="$(node -p "require('./package.json').engines?.pnpm || ''")"
NODE_ENGINES_EXPECTED="$(node -p "require('./release/pulse-release-manifest.json').publication.nodeEngines")"
NODE_MINIMUM_EXPECTED="$(node -p "require('./release/pulse-release-manifest.json').publication.nodeMinimumVersion")"
RELEASE_NODE_EXPECTED="$(node -p "require('./release/pulse-release-manifest.json').publication.nodeVersion")"
AS_EXPECTED="$(node -p "require('./wasm/package.json').devDependencies?.assemblyscript || require('./wasm/package.json').dependencies?.assemblyscript || ''")"
JSON_AS_EXPECTED="$(node -p "require('./wasm/packages/compiler/package.json').dependencies?.['json-as'] || ''")"
XJB_AS_EXPECTED="$(node -e 'const f=require("node:fs").readFileSync("pnpm-lock.yaml","utf8"); process.stdout.write(/(?:^|\\n)  xjb-as@0\\.1\\.0:\\r?\\n/.test(f) ? "0.1.0" : "")')"
[[ "$AS_EXPECTED" == "0.28.18" ]] || fail "expected AssemblyScript 0.28.18, found $AS_EXPECTED"
[[ "$ROOT_PNPM_RANGE" == "$PNPM_DEVELOPMENT_RANGE" ]] \
  || fail "root pnpm development range $ROOT_PNPM_RANGE differs from release policy $PNPM_DEVELOPMENT_RANGE"
[[ "$JSON_AS_EXPECTED" == "1.5.0" ]] || fail "expected json-as 1.5.0, found $JSON_AS_EXPECTED"
[[ "$XJB_AS_EXPECTED" == "0.1.0" ]] || fail "expected lockfile-pinned xjb-as 0.1.0"

export COREPACK_ENABLE_NETWORK=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export PNPM_HOME="$ROOT/.cache/pnpm-home"
export PNPM_STORE_DIR="$ROOT/.pnpm-store"
export XDG_CACHE_HOME="$ROOT/.cache/xdg"
export npm_config_cache="$ROOT/.cache/npm"
export npm_config_offline=true
export npm_config_prefer_offline=true
export npm_config_update_notifier=false
export PATH="$PNPM_HOME:$PATH"

LIST_FILE="$(mktemp "${TMPDIR:-/tmp}/pulse-deps-list.XXXXXX")"
STAGE="$(mktemp -d "$ROOT/.pulse-deps-restore.XXXXXX")"
BACKUP="$(mktemp -d "$ROOT/.pulse-deps-backup.XXXXXX")"
INSTALL_COMMITTED=0
SWAP_STARTED=0
cleanup() {
  local status=$?
  rm -f "$LIST_FILE"
  rm -rf "$STAGE"

  if [[ "$SWAP_STARTED" == "1" && "$INSTALL_COMMITTED" != "1" ]]; then
    rm -rf "$ROOT/.pnpm-store" "$ROOT/.validation-tools"
    if [[ -d "$BACKUP/.pnpm-store" ]]; then mv "$BACKUP/.pnpm-store" "$ROOT/.pnpm-store"; fi
    if [[ -d "$BACKUP/.validation-tools" ]]; then mv "$BACKUP/.validation-tools" "$ROOT/.validation-tools"; fi
  fi
  rm -rf "$BACKUP"
  exit "$status"
}
trap cleanup EXIT

info "Validating dependency archive paths"
zstd -dc "$BUNDLE" | tar -tf - > "$LIST_FILE"
node - "$LIST_FILE" <<'NODE'
const fs = require('node:fs');
const entries = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean);
const exact = new Set([
  './',
  './.pnpm-store',
  './.validation-tools',
  './.validation-tools/pnpm',
  './.pulse-dependency-bundle.json'
]);
const prefixes = ['./.pnpm-store/', './.validation-tools/pnpm/'];
for (const raw of entries) {
  let value = raw.startsWith('./') ? raw : `./${raw}`;
  if (value !== './') value = value.replace(/\/+$/, '');
  const permitted = exact.has(value) || prefixes.some((prefix) => value.startsWith(prefix));
  if (value.includes('/../') || value === './..' || value.startsWith('/') || !permitted) {
    throw new Error(`unsafe or unexpected dependency bundle path: ${raw}`);
  }
}
if (!entries.some((entry) => /(?:^|\/)\.pulse-dependency-bundle\.json$/.test(entry))) {
  throw new Error('dependency bundle manifest is missing');
}
NODE

info "Extracting and validating the bundle before replacing local dependencies"
zstd -dc "$BUNDLE" | tar -C "$STAGE" -xf -
[[ -f "$STAGE/.pulse-dependency-bundle.json" ]] || fail "dependency bundle manifest was not extracted"
[[ -x "$STAGE/.validation-tools/pnpm/bin/pnpm" ]] || fail "bundle does not contain its pnpm runner"
if find "$STAGE" -type l -print -quit | grep -q .; then
  fail "dependency bundle contains symbolic links"
fi

[[ -f /etc/os-release ]] || fail "cannot verify the target Linux distribution: /etc/os-release is missing"
HOST_DISTRIBUTION="$(. /etc/os-release; printf '%s-%s' "${ID:-unknown}" "${VERSION_CODENAME:-unknown}")"
[[ "$HOST_DISTRIBUTION" == "$EXPECTED_DISTRIBUTION" ]] \
  || fail "dependency bundle distribution mismatch: expected $EXPECTED_DISTRIBUTION, running on $HOST_DISTRIBUTION"

node - "$STAGE/.pulse-dependency-bundle.json" "$PNPM_EXPECTED" "$AS_EXPECTED" \
  "$JSON_AS_EXPECTED" "$XJB_AS_EXPECTED" "$EXPECTED_DISTRIBUTION" \
  "$NODE_ENGINES_EXPECTED" "$NODE_MINIMUM_EXPECTED" "$RELEASE_NODE_EXPECTED" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [file, pnpm, assemblyscript, jsonAs, xjbAs, distribution, nodeEngines, nodeMinimumVersion, releaseNode] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const lockHash = crypto.createHash('sha256').update(fs.readFileSync('pnpm-lock.yaml')).digest('hex');
if (process.versions.node !== releaseNode) {
  throw new Error(`restore requires release-owned Node ${releaseNode}; running ${process.versions.node}`);
}
const expected = {
  version: 'pulse.dependency-bundle.v5',
  builder: 'docker-build-export',
  targetDistribution: distribution,
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  nodeEngines,
  nodeMinimumVersion,
  pnpm,
  lockfileVerification: 'verified-during-fetch-and-bound-by-sha256',
  assemblyscript,
  jsonAs,
  xjbAs,
  lockfileSha256: lockHash,
  nodeModulesIncluded: false,
  offlineInstallRequired: true,
  storePreparation: 'fetched-in-target-container'
};
for (const [key, value] of Object.entries(expected)) {
  if (manifest[key] !== value) {
    throw new Error(`dependency bundle ${key} mismatch: ${JSON.stringify(manifest[key])} !== ${JSON.stringify(value)}`);
  }
}
const expectedRestore = {
  command: './restore_pulsewasm_dependencies_portable.sh <bundle.tar.zst>',
  validationCommand: 'npm run release:seal -- --skip-install'
};
if (JSON.stringify(manifest.restore) !== JSON.stringify(expectedRestore)) {
  throw new Error(`dependency bundle restore instructions mismatch: ${JSON.stringify(manifest.restore)}`);
}
if (manifest.nodeMajor !== Number(process.versions.node.split('.')[0])) {
  throw new Error(`dependency bundle nodeMajor mismatch: ${manifest.nodeMajor}`);
}
if (JSON.stringify(manifest.contents) !== JSON.stringify(['.pnpm-store', '.validation-tools/pnpm'])) {
  throw new Error(`dependency bundle contents mismatch: ${JSON.stringify(manifest.contents)}`);
}
NODE

[[ "$("$STAGE/.validation-tools/pnpm/bin/pnpm" --version)" == "$PNPM_EXPECTED" ]] || fail "bundled pnpm version mismatch"

if [[ "$VERIFY_ONLY" == "1" ]]; then
  info "Dependency bundle is safe and exactly compatible with this workspace/runtime"
  INSTALL_COMMITTED=1
  exit 0
fi

info "Preparing transactional dependency replacement"
SWAP_STARTED=1
if [[ -d "$ROOT/.pnpm-store" ]]; then mv "$ROOT/.pnpm-store" "$BACKUP/.pnpm-store"; fi
if [[ -d "$ROOT/.validation-tools" ]]; then mv "$ROOT/.validation-tools" "$BACKUP/.validation-tools"; fi
mv "$STAGE/.pnpm-store" "$ROOT/.pnpm-store"
mkdir -p "$ROOT/.validation-tools"
mv "$STAGE/.validation-tools/pnpm" "$ROOT/.validation-tools/pnpm"
cp "$STAGE/.pulse-dependency-bundle.json" "$ROOT/.validation-tools/pulse-dependency-bundle.json"

PNPM=("$ROOT/.validation-tools/pnpm/bin/pnpm")
export PATH="$ROOT/.validation-tools/pnpm/bin:$PATH"
info "Bundled toolchain preflight"
node --version
"${PNPM[@]}" --version

info "Removing stale dependency links"
rm -rf node_modules wasm/node_modules test/node_modules
rm -rf packages/*/node_modules wasm/packages/*/node_modules

info "Reconstructing the current workspace from the offline store"
# Registry policies were checked during bundle creation; the manifest above
# binds that result to this exact lockfile and toolchain. Package integrity
# checks remain active. Never use trust-lockfile for online installs or CI.
"${PNPM[@]}" --config.trust-lockfile=true install --offline --frozen-lockfile --ignore-scripts --store-dir "$PNPM_STORE_DIR"

info "Verifying compiler versions"
[[ "$("${PNPM[@]}" --version)" == "$PNPM_EXPECTED" ]] || fail "pnpm version mismatch"
[[ "$(./wasm/node_modules/.bin/asc --version | awk '{print $2}')" == "$AS_EXPECTED" ]] || fail "AssemblyScript version mismatch"
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const compilerRoot = path.resolve('wasm/packages/compiler');
const assemblyscript = JSON.parse(fs.readFileSync(require.resolve('assemblyscript/package.json', { paths: [compilerRoot] }), 'utf8'));
const jsonAsRoot = path.resolve(require.resolve('json-as', { paths: [compilerRoot] }), '..', '..', '..');
const jsonAs = JSON.parse(fs.readFileSync(path.join(jsonAsRoot, 'package.json'), 'utf8'));
const xjbAs = JSON.parse(fs.readFileSync(path.join(path.dirname(jsonAsRoot), 'xjb-as/package.json'), 'utf8'));
if (assemblyscript.version !== '0.28.18') throw new Error(`unexpected AssemblyScript version ${assemblyscript.version}`);
if (jsonAs.version !== '1.5.0') throw new Error(`unexpected json-as version ${jsonAs.version}`);
if (xjbAs.version !== '0.1.0') throw new Error(`unexpected xjb-as version ${xjbAs.version}`);
const pkg = require('./packages/provider-fastly/package.json');
if (pkg.dependencies && pkg.dependencies['@fastly/js-compute']) throw new Error('Fastly JavaScript runtime dependency must not be present');
if (!fs.existsSync('./packages/provider-fastly/src/build/canonical-target.js')) throw new Error('native Fastly canonical target is missing');
const target = require('./packages/provider-fastly/src/build/canonical-target.js');
if (target.FASTLY_CANONICAL_TARGET !== 'fastly-compute-native') throw new Error(`unexpected Fastly target ${target.FASTLY_CANONICAL_TARGET}`);
console.log(target.FASTLY_CANONICAL_TARGET);
NODE

# The new store/toolchain is now proven and remains installed.
INSTALL_COMMITTED=1
rm -rf "$BACKUP"
info "Portable dependency restore completed without registry access"
