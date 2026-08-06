#!/usr/bin/env bash
# Build a target-specific, store-only Pulse dependency bundle inside a pinned
# Debian container and export it to the host. The host platform never determines
# the bundle identity.
#
# Usage:
#   ./bundle_pulsewasm_dependencies_portable.sh [options] [output.tar.zst]
#
# The default target is:
#   linux/amd64, Debian trixie, Node 24.18.0, lockfile-pinned pnpm/AssemblyScript/json-as
set -euo pipefail

fail() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }
usage() {
  cat <<'USAGE'
Usage: ./bundle_pulsewasm_dependencies_portable.sh [options] [output.tar.zst]

Builds the dependency store inside a pinned Debian container, then exports a
store-only archive containing:
  .pnpm-store
  .validation-tools/pnpm
  .pulse-dependency-bundle.json

Options:
  --offline                   Disable network for the Docker build. This works
                              only when the base image and all build layers are
                              already cached.
  --platform <os/arch>        Docker target platform (default: linux/amd64).
  --node-version <version>    Target Node version (release-owned default: 24.18.0).
  --image <image>             Debian Node image. Defaults to
                              node:<node-version>-trixie-slim.
  --distribution <name>       Manifest distribution label
                              (default: debian-trixie).
  --source-date-epoch <secs>  Reproducible archive timestamp
                              (default: 1783900800).
  -o, --output <path>         Output archive path. A single positional output
                              path remains supported.
  -h, --help                  Show this help.

The script intentionally has no automatic host-native fallback. If Docker or
BuildKit is unavailable, it fails instead of creating a bundle for the host OS.
USAGE
}

OFFLINE=0
TARGET_PLATFORM="${PULSE_DEPENDENCY_TARGET_PLATFORM:-linux/amd64}"
TARGET_NODE_VERSION="${PULSE_DEPENDENCY_TARGET_NODE_VERSION:-24.18.0}"
TARGET_DISTRIBUTION="${PULSE_DEPENDENCY_TARGET_DISTRIBUTION:-debian-trixie}"
BASE_IMAGE="${PULSE_DEPENDENCY_BASE_IMAGE:-}"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1783900800}"
OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline) OFFLINE=1 ;;
    --platform)
      shift; [[ $# -gt 0 ]] || fail "--platform requires a value"
      TARGET_PLATFORM="$1"
      ;;
    --node-version)
      shift; [[ $# -gt 0 ]] || fail "--node-version requires a value"
      TARGET_NODE_VERSION="$1"
      ;;
    --image)
      shift; [[ $# -gt 0 ]] || fail "--image requires a value"
      BASE_IMAGE="$1"
      ;;
    --distribution)
      shift; [[ $# -gt 0 ]] || fail "--distribution requires a value"
      TARGET_DISTRIBUTION="$1"
      ;;
    --source-date-epoch)
      shift; [[ $# -gt 0 ]] || fail "--source-date-epoch requires a value"
      SOURCE_DATE_EPOCH="$1"
      ;;
    -o|--output)
      option="$1"
      shift; [[ $# -gt 0 ]] || fail "$option requires a value"
      [[ -z "$OUTPUT" ]] || fail "output was specified more than once"
      OUTPUT="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) fail "unknown option: $1" ;;
    *)
      [[ -z "$OUTPUT" ]] || fail "only one output archive may be specified"
      OUTPUT="$1"
      ;;
  esac
  shift
done
[[ $# -eq 0 ]] || fail "unexpected argument(s): $*"

[[ -f package.json && -f pnpm-lock.yaml && -f pnpm-workspace.yaml && -f wasm/package.json ]] \
  || fail "run from the repository root"
for command in node docker tar zstd; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is unavailable"

[[ "$TARGET_PLATFORM" == linux/* ]] || fail "the Docker-first bundle must target Linux, found $TARGET_PLATFORM"
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]+$ ]] || fail "--source-date-epoch must be an integer"
[[ "$TARGET_NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "--node-version must be an exact x.y.z version"

ROOT="$(pwd)"
PNPM_EXPECTED="$(node -p "require('./release/pulse-release-manifest.json').publication.pnpmVersion")"
PNPM_DEVELOPMENT_RANGE="$(node -p "require('./release/pulse-release-manifest.json').publication.pnpmDevelopmentRange")"
ROOT_PNPM_RANGE="$(node -p "require('./package.json').engines?.pnpm || ''")"
NODE_ENGINES="$(node -p "require('./release/pulse-release-manifest.json').publication.nodeEngines")"
NODE_MINIMUM_VERSION="$(node -p "require('./release/pulse-release-manifest.json').publication.nodeMinimumVersion")"
RELEASE_NODE_VERSION="$(node -p "require('./release/pulse-release-manifest.json').publication.nodeVersion")"
AS_VERSION="$(node -p "require('./wasm/package.json').devDependencies?.assemblyscript || require('./wasm/package.json').dependencies?.assemblyscript || ''")"
JSON_AS_VERSION="$(node -p "require('./wasm/packages/compiler/package.json').dependencies?.['json-as'] || ''")"
XJB_AS_VERSION="$(node -e 'const f=require("node:fs").readFileSync("pnpm-lock.yaml","utf8"); process.stdout.write(/(?:^|\\n)  xjb-as@0\\.1\\.0:\\r?\\n/.test(f) ? "0.1.0" : "")')"
LOCK_SHA256="$(node -e 'const c=require("node:crypto"),f=require("node:fs"); process.stdout.write(c.createHash("sha256").update(f.readFileSync("pnpm-lock.yaml")).digest("hex"))')"

[[ "$ROOT_PNPM_RANGE" == "$PNPM_DEVELOPMENT_RANGE" ]] \
  || fail "root pnpm development range $ROOT_PNPM_RANGE differs from release policy $PNPM_DEVELOPMENT_RANGE"
[[ "$TARGET_NODE_VERSION" == "$RELEASE_NODE_VERSION" ]] \
  || fail "dependency bundle Node $TARGET_NODE_VERSION differs from release-owned Node $RELEASE_NODE_VERSION"
[[ "$AS_VERSION" == "0.28.18" ]] || fail "expected AssemblyScript 0.28.18, found $AS_VERSION"
[[ "$JSON_AS_VERSION" == "1.5.0" ]] || fail "expected json-as 1.5.0, found $JSON_AS_VERSION"
[[ "$XJB_AS_VERSION" == "0.1.0" ]] || fail "expected lockfile-pinned xjb-as 0.1.0"

BASE_IMAGE="${BASE_IMAGE:-node:${TARGET_NODE_VERSION}-trixie-slim}"
TARGET_OS="${TARGET_PLATFORM%%/*}"
TARGET_ARCH_LABEL="${TARGET_PLATFORM#*/}"
case "$TARGET_ARCH_LABEL" in
  amd64) TARGET_ARCH_NODE="x64" ;;
  arm64) TARGET_ARCH_NODE="arm64" ;;
  *) fail "unsupported target architecture: $TARGET_ARCH_LABEL" ;;
esac

DEFAULT_NAME="pulse-wasm-deps-${TARGET_OS}-${TARGET_ARCH_LABEL}-${TARGET_DISTRIBUTION}-node${TARGET_NODE_VERSION}-pnpm${PNPM_EXPECTED}-as${AS_VERSION}-jsonas${JSON_AS_VERSION}.tar.zst"
OUTPUT="${OUTPUT:-$ROOT/$DEFAULT_NAME}"
OUTPUT="$(node -e 'const p=require("node:path"); console.log(p.resolve(process.argv[1]))' "$OUTPUT")"
mkdir -p "$(dirname "$OUTPUT")"

CONTEXT="$(mktemp -d "$ROOT/.pulse-deps-docker-context.XXXXXX")"
EXPORT_STAGE="$(mktemp -d "$ROOT/.pulse-deps-docker-export.XXXXXX")"
cleanup() { rm -rf "$CONTEXT" "$EXPORT_STAGE"; }
trap cleanup EXIT

cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$CONTEXT/"
mkdir -p "$CONTEXT/release"
cp release/pulse-release-manifest.json "$CONTEXT/release/pulse-release-manifest.json"
mkdir -p "$CONTEXT/wasm"
cp wasm/package.json "$CONTEXT/wasm/package.json"
mkdir -p "$CONTEXT/wasm/packages/compiler"
cp wasm/packages/compiler/package.json "$CONTEXT/wasm/packages/compiler/package.json"

cat > "$CONTEXT/Dockerfile" <<'DOCKERFILE'
# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS bundle

ARG TARGET_NODE_VERSION
ARG NODE_ENGINES
ARG NODE_MINIMUM_VERSION
ARG TARGET_DISTRIBUTION
ARG PNPM_VERSION
ARG AS_VERSION
ARG JSON_AS_VERSION
ARG XJB_AS_VERSION
ARG LOCK_SHA256
ARG SOURCE_DATE_EPOCH
ARG OUTPUT_BASENAME
ARG BASE_IMAGE

ENV TARGET_NODE_VERSION=${TARGET_NODE_VERSION} \
    NODE_ENGINES=${NODE_ENGINES} \
    NODE_MINIMUM_VERSION=${NODE_MINIMUM_VERSION} \
    TARGET_DISTRIBUTION=${TARGET_DISTRIBUTION} \
    PNPM_VERSION=${PNPM_VERSION} \
    AS_VERSION=${AS_VERSION} \
    JSON_AS_VERSION=${JSON_AS_VERSION} \
    XJB_AS_VERSION=${XJB_AS_VERSION} \
    LOCK_SHA256=${LOCK_SHA256} \
    SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} \
    OUTPUT_BASENAME=${OUTPUT_BASENAME} \
    BASE_IMAGE=${BASE_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates zstd \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY release/pulse-release-manifest.json ./release/pulse-release-manifest.json
COPY wasm/package.json ./wasm/package.json
COPY wasm/packages/compiler/package.json ./wasm/packages/compiler/package.json

RUN node - <<'NODE'
const fs = require('node:fs');
const expectedNode = process.env.TARGET_NODE_VERSION;
if (process.versions.node !== expectedNode) {
  throw new Error(`container Node mismatch: ${process.versions.node} !== ${expectedNode}`);
}
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const release = JSON.parse(fs.readFileSync('release/pulse-release-manifest.json', 'utf8'));
const wasm = JSON.parse(fs.readFileSync('wasm/package.json', 'utf8'));
const compiler = JSON.parse(fs.readFileSync('wasm/packages/compiler/package.json', 'utf8'));
const pnpm = release.publication?.pnpmVersion || '';
const assemblyscript = wasm.devDependencies?.assemblyscript || wasm.dependencies?.assemblyscript || '';
const jsonAs = compiler.dependencies?.['json-as'] || '';
if (pnpm !== process.env.PNPM_VERSION) throw new Error(`pnpm mismatch: ${pnpm}`);
if (root.engines?.pnpm !== release.publication?.pnpmDevelopmentRange) throw new Error(`pnpm development range mismatch: ${root.engines?.pnpm}`);
if (assemblyscript !== process.env.AS_VERSION) throw new Error(`AssemblyScript mismatch: ${assemblyscript}`);
if (jsonAs !== process.env.JSON_AS_VERSION) throw new Error(`json-as mismatch: ${jsonAs}`);
const lock = fs.readFileSync('pnpm-lock.yaml', 'utf8').replace(/\r\n/g, '\n');
if (!lock.includes(`\n  xjb-as@${process.env.XJB_AS_VERSION}:\n`)) {
  throw new Error(`xjb-as ${process.env.XJB_AS_VERSION} is not pinned in the lockfile`);
}
NODE

RUN mkdir -p /bundle/.validation-tools/pnpm /tmp/pnpm-pack \
 && npm pack --silent "pnpm@${PNPM_VERSION}" --pack-destination /tmp/pnpm-pack >/tmp/pnpm-tarball.txt \
 && PNPM_TARBALL="$(tail -n 1 /tmp/pnpm-tarball.txt)" \
 && tar -xzf "/tmp/pnpm-pack/${PNPM_TARBALL}" -C /tmp/pnpm-pack \
 && cp -a /tmp/pnpm-pack/package/. /bundle/.validation-tools/pnpm/ \
 && node /bundle/.validation-tools/pnpm/bin/pnpm.cjs --version | grep -Fx "${PNPM_VERSION}"

RUN node /bundle/.validation-tools/pnpm/bin/pnpm.cjs fetch \
      --frozen-lockfile \
      --store-dir /bundle/.pnpm-store

RUN node - <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const lockHash = crypto.createHash('sha256').update(fs.readFileSync('pnpm-lock.yaml')).digest('hex');
if (lockHash !== process.env.LOCK_SHA256) {
  throw new Error(`lockfile hash mismatch: ${lockHash} !== ${process.env.LOCK_SHA256}`);
}
const manifest = {
  version: 'pulse.dependency-bundle.v5',
  builder: 'docker-build-export',
  baseImage: process.env.BASE_IMAGE,
  targetDistribution: process.env.TARGET_DISTRIBUTION,
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  nodeMajor: Number(process.versions.node.split('.')[0]),
  nodeEngines: process.env.NODE_ENGINES,
  nodeMinimumVersion: process.env.NODE_MINIMUM_VERSION,
  pnpm: process.env.PNPM_VERSION,
  assemblyscript: process.env.AS_VERSION,
  jsonAs: process.env.JSON_AS_VERSION,
  xjbAs: process.env.XJB_AS_VERSION,
  lockfileSha256: lockHash,
  sourceDateEpoch: Number(process.env.SOURCE_DATE_EPOCH),
  contents: ['.pnpm-store', '.validation-tools/pnpm'],
  nodeModulesIncluded: false,
  offlineInstallRequired: true,
  storePreparation: 'fetched-in-target-container',
  restore: {
    command: './restore_pulsewasm_dependencies_portable.sh <bundle.tar.zst>',
    validationCommand: 'npm run release:seal -- --skip-install'
  }
};
fs.writeFileSync('/bundle/.pulse-dependency-bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
NODE

RUN mkdir -p /out \
 && tar --sort=name \
      --mtime="@${SOURCE_DATE_EPOCH}" \
      --owner=0 --group=0 --numeric-owner \
      -C /bundle -cf - . \
    | zstd -6 -T0 -q -o "/out/${OUTPUT_BASENAME}" \
 && sha256sum "/out/${OUTPUT_BASENAME}" > "/out/${OUTPUT_BASENAME}.sha256" \
 && zstd -dc "/out/${OUTPUT_BASENAME}" | tar -tf - >/dev/null

FROM scratch AS export
COPY --from=bundle /out/ /
DOCKERFILE

BUILD_ARGS=(
  --platform "$TARGET_PLATFORM"
  --build-arg "BASE_IMAGE=$BASE_IMAGE"
  --build-arg "TARGET_NODE_VERSION=$TARGET_NODE_VERSION"
  --build-arg "NODE_ENGINES=$NODE_ENGINES"
  --build-arg "NODE_MINIMUM_VERSION=$NODE_MINIMUM_VERSION"
  --build-arg "TARGET_DISTRIBUTION=$TARGET_DISTRIBUTION"
  --build-arg "PNPM_VERSION=$PNPM_EXPECTED"
  --build-arg "AS_VERSION=$AS_VERSION"
  --build-arg "JSON_AS_VERSION=$JSON_AS_VERSION"
  --build-arg "XJB_AS_VERSION=$XJB_AS_VERSION"
  --build-arg "LOCK_SHA256=$LOCK_SHA256"
  --build-arg "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"
  --build-arg "OUTPUT_BASENAME=$DEFAULT_NAME"
  --target export
)
[[ "$OFFLINE" == "1" ]] && BUILD_ARGS+=(--network=none)

info "Building dependency bundle in $BASE_IMAGE for $TARGET_PLATFORM"
if docker buildx version >/dev/null 2>&1; then
  docker buildx build \
    "${BUILD_ARGS[@]}" \
    --output "type=local,dest=$EXPORT_STAGE" \
    "$CONTEXT"
else
  info "docker buildx is unavailable; using Docker BuildKit output"
  DOCKER_BUILDKIT=1 docker build \
    "${BUILD_ARGS[@]}" \
    --output "type=local,dest=$EXPORT_STAGE" \
    "$CONTEXT"
fi

EXPORTED="$EXPORT_STAGE/$DEFAULT_NAME"
[[ -f "$EXPORTED" ]] || fail "Docker build did not export $DEFAULT_NAME"

info "Validating exported bundle identity"
MANIFEST_STAGE="$(mktemp -d "$ROOT/.pulse-deps-manifest.XXXXXX")"
zstd -dc "$EXPORTED" | tar -C "$MANIFEST_STAGE" -xf - ./.pulse-dependency-bundle.json
node - "$MANIFEST_STAGE/.pulse-dependency-bundle.json" \
  "$TARGET_DISTRIBUTION" "$TARGET_ARCH_NODE" "$TARGET_NODE_VERSION" \
  "$PNPM_EXPECTED" "$AS_VERSION" "$LOCK_SHA256" "$BASE_IMAGE" \
  "$JSON_AS_VERSION" "$XJB_AS_VERSION" "$NODE_ENGINES" \
  "$NODE_MINIMUM_VERSION" <<'NODE'
const fs = require('node:fs');
const [file, distribution, arch, nodeVersion, pnpm, assemblyscript, lockHash, baseImage, jsonAs, xjbAs, nodeEngines, nodeMinimumVersion] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const expected = {
  version: 'pulse.dependency-bundle.v5',
  builder: 'docker-build-export',
  baseImage,
  targetDistribution: distribution,
  platform: 'linux',
  arch,
  node: nodeVersion,
  nodeEngines,
  nodeMinimumVersion,
  pnpm,
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
    throw new Error(`exported bundle ${key} mismatch: ${JSON.stringify(manifest[key])} !== ${JSON.stringify(value)}`);
  }
}
const expectedRestore = {
  command: './restore_pulsewasm_dependencies_portable.sh <bundle.tar.zst>',
  validationCommand: 'npm run release:seal -- --skip-install'
};
if (JSON.stringify(manifest.restore) !== JSON.stringify(expectedRestore)) {
  throw new Error(`exported bundle restore instructions mismatch: ${JSON.stringify(manifest.restore)}`);
}
NODE
rm -rf "$MANIFEST_STAGE"

rm -f "$OUTPUT" "$OUTPUT.sha256"
mv "$EXPORTED" "$OUTPUT"
BUNDLE_SHA256="$(node -e 'const c=require("node:crypto"),f=require("node:fs"); process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$OUTPUT")"
printf '%s  %s\n' "$BUNDLE_SHA256" "$(basename "$OUTPUT")" > "$OUTPUT.sha256"

printf '%s  %s\n' "$BUNDLE_SHA256" "$OUTPUT"
info "Docker-exported portable dependency bundle completed"
