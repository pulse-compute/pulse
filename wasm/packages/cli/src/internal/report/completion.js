'use strict';

const { copyData, parseJson, canonicalJson, sha256, relativePath, fail, freeze } = require('./data');
const { completionSchema, attributionSchema, fileSchema } = require('./schema');
const { validate } = require('./validate');
const { artifactId, validateCapsule, parseCapsule } = require('./capsule');
const ensure = (value, code) => { if (!value) fail(code); };
const MANIFEST_VERSION = 'pulse.project-execution.v10';
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
function manifestCandidate(input) {
  const manifest = copyData(input);
  ensure(manifest?.version === MANIFEST_VERSION, 'REPORT_INPUT_VERSION');
  if (manifest.status === 'compiled' && manifest.target === 'portable-native-wasm') {
    return { manifest, operation: 'compile', wasm: manifest.native?.wasm, host: manifest.configuredProvider };
  }
  ensure(manifest.status === 'built', 'REPORT_INCOMPLETE_BUILD');
  ensure(manifest.buildMode === 'native-provider' && manifest.configuredTarget === 'native'
    && manifest.providerTarget?.nativeWasm === true && manifest.providerTarget?.compiledWasmPresent === true
    && manifest.providerTarget?.javascriptRuntime === false, 'REPORT_UNSUPPORTED_TARGET');
  const target = manifest.providerTarget.wasm, portable = manifest.portable?.wasm;
  // Some native hosts use the exact portable bytes and omit a second file name.
  // This is a byte-identity adapter, not a host-name fallback.
  const wasm = target?.file ? target : target && portable && target.sha256 === portable.sha256
    && target.bytes === portable.bytes ? portable : null;
  return { manifest, operation: 'native-build', wasm, host: manifest.provider };
}
function classifyInput(input) {
  const value = parseJson(input);
  if (value?.kind === 'pulse.application-report') return { kind: 'historical-capsule', capsule: validateCapsule(value) };
  return { kind: 'build-manifest', operation: manifestCandidate(value).operation, manifest: value };
}
function verifyBytes(reference, input, wasm = false) {
  ensure(Buffer.isBuffer(input) || input instanceof Uint8Array, 'REPORT_MISSING_ARTIFACT');
  ensure(input.byteLength <= MAX_ARTIFACT_BYTES, 'REPORT_LIMIT');
  const bytes = Buffer.from(input);
  ensure(bytes.length === reference.bytes && sha256(bytes) === reference.sha256, 'REPORT_ARTIFACT_HASH');
  if (wasm) ensure(WebAssembly.validate(bytes), 'REPORT_INVALID_WASM');
  return bytes;
}
function validateAttribution(input) {
  const value = typeof input === 'string' || input instanceof Uint8Array ? parseJson(input) : copyData(input);
  validate(value, attributionSchema);
  ensure(value.artifactId === artifactId(value.artifactSha256), 'REPORT_IDENTITY');
  const last = value.importedFunctions + value.functions.length;
  value.functions.forEach((fn, index) => ensure(fn.index === value.importedFunctions + index, 'REPORT_ATTRIBUTION'));
  const chunks = new Map(), entries = new Set(), edges = new Set();
  for (const row of value.chunkMappings) {
    ensure(!chunks.has(row.chunk), 'REPORT_DUPLICATE'); chunks.set(row.chunk, row);
    ensure(row.functionIndex === null ? row.reason !== null
      : row.reason === null && row.functionIndex >= value.importedFunctions && row.functionIndex < last, 'REPORT_ATTRIBUTION');
  }
  for (const row of value.handlerBodies || []) {
    ensure(!entries.has(row.entryId) && new Set(row.chunks).size === row.chunks.length, 'REPORT_DUPLICATE'); entries.add(row.entryId);
    ensure(row.chunks.every(chunk => chunks.has(chunk)), 'REPORT_ATTRIBUTION');
  }
  if (value.attributionVersion === 2) {
    for (const row of value.chunkMappings) ensure((row.kind === 'dispatcher-carrier') === (row.implementationId === null), 'REPORT_ATTRIBUTION');
    for (const row of value.entries) {
      ensure(!entries.has(row.entryId), 'REPORT_DUPLICATE'); entries.add(row.entryId);
      ensure(new Set(row.bodies.map(body => body.chunk)).size === row.bodies.length, 'REPORT_DUPLICATE');
      ensure(row.bodies.some(body => body.relation !== 'shared-helper-body') ? row.reason === null : row.reason !== null, 'REPORT_ATTRIBUTION');
      for (const body of row.bodies) {
        const mapping = chunks.get(body.chunk);
        ensure(mapping && mapping.kind === body.relation, 'REPORT_ATTRIBUTION');
        if (mapping.kind === 'terminal-body') ensure(mapping.implementationId === row.entryId, 'REPORT_IDENTITY');
      }
    }
  }
  if (value.graph.state === 'available') {
    ensure(value.graph.reason === null, 'REPORT_ATTRIBUTION');
    for (const edge of value.graph.edges) {
      ensure(edge.caller >= value.importedFunctions && edge.caller < last && edge.callee < last, 'REPORT_ATTRIBUTION');
      const key = `${edge.caller}:${edge.callee}`; ensure(!edges.has(key), 'REPORT_DUPLICATE'); edges.add(key);
    }
  } else ensure(value.graph.reason !== null && value.graph.edges.length === 0, 'REPORT_ATTRIBUTION');
  return freeze(value);
}
function admitCompletedBuild(input, completionBytes, options) {
  const { manifest, operation, wasm, host } = manifestCandidate(input);
  ensure(manifest.reportCompletion && completionBytes !== undefined, 'REPORT_MISSING_COMPLETION');
  const link = copyData(manifest.reportCompletion);
  validate(link, fileSchema); relativePath(link.file);
  const raw = verifyBytes(link, completionBytes);
  const completion = parseJson(raw);
  if (completion?.kind !== 'pulse.report-completion' || completion.completionVersion !== 1) fail('REPORT_INPUT_VERSION');
  if (completion.status !== 'complete') fail('REPORT_INCOMPLETE_BUILD');
  validate(completion, completionSchema);
  ensure(completion.operation === operation && completion.context.host === host, 'REPORT_IDENTITY');
  ensure(options && options.files instanceof Map, 'REPORT_DATA');
  if (options.snapshot !== undefined) {
    const snapshot = copyData(options.snapshot);
    validate(snapshot, completionSchema.properties.snapshot, completionSchema);
    ensure(canonicalJson(snapshot) === canonicalJson(completion.snapshot), 'REPORT_STALE_INPUTS');
    ensure(options.selection?.profile === completion.context.profile && options.selection?.host === completion.context.host
      && options.selection?.target === 'native', 'REPORT_IDENTITY');
  }
  ensure(wasm && Number.isSafeInteger(wasm.bytes) && typeof wasm.sha256 === 'string', 'REPORT_MISSING_ARTIFACT');
  const paths = new Set([link.file]), ids = new Set();
  for (const artifact of completion.artifacts) {
    relativePath(artifact.file);
    ensure(!paths.has(artifact.file) && !ids.has(artifact.id), 'REPORT_DUPLICATE');
    paths.add(artifact.file); ids.add(artifact.id);
    ensure(artifact.id === artifactId(artifact.sha256), 'REPORT_IDENTITY');
    verifyBytes(artifact, options.files.get(artifact.file), true);
  }
  const primary = completion.artifacts.find(row => row.id === completion.context.primaryArtifactId);
  ensure(primary && primary.stage === 'final' && primary.sha256 === wasm.sha256
    && primary.bytes === wasm.bytes && primary.file === relativePath(wasm.file), 'REPORT_IDENTITY');
  const availableSidecars = [], missingOptionalSidecars = [];
  const kinds = new Set();
  for (const sidecar of completion.sidecars) {
    relativePath(sidecar.file);
    ensure(!paths.has(sidecar.file) && !kinds.has(sidecar.kind), 'REPORT_DUPLICATE');
    paths.add(sidecar.file); kinds.add(sidecar.kind);
    if (!options.files.has(sidecar.file)) {
      ensure(!sidecar.required, 'REPORT_MISSING_SIDECAR');
      missingOptionalSidecars.push(sidecar.kind);
    } else {
      const bytes = verifyBytes(sidecar, options.files.get(sidecar.file));
      if (sidecar.kind === 'inventory') {
        const inventory = parseCapsule(bytes);
        ensure(canonicalJson(inventory.context) === canonicalJson(completion.context), 'REPORT_IDENTITY');
        for (const artifact of inventory.artifacts) ensure(completion.artifacts.some(row => row.id === artifact.id
          && row.bytes === artifact.bytes && row.sha256 === artifact.sha256 && row.stage === artifact.stage), 'REPORT_IDENTITY');
      } else {
        const attribution = validateAttribution(bytes);
        ensure(sidecar.version === attribution.attributionVersion, 'REPORT_INPUT_VERSION');
        ensure(completion.artifacts.some(row => row.id === attribution.artifactId && row.stage === attribution.stage), 'REPORT_IDENTITY');
      }
      availableSidecars.push(sidecar.kind);
    }
  }
  ensure(completion.sidecars.some(row => row.kind === 'inventory' && row.required), 'REPORT_MISSING_SIDECAR');
  return freeze({ kind: 'completed-wasm', completion, availableSidecars, missingOptionalSidecars,
    currentSnapshotMatched: options.snapshot !== undefined });
}
function verifyHistoricalArtifacts(input, files = new Map()) {
  const capsule = typeof input === 'string' || Buffer.isBuffer(input) ? parseCapsule(input) : validateCapsule(input);
  ensure(files instanceof Map, 'REPORT_DATA');
  const verified = [], absent = [];
  for (const artifact of capsule.artifacts) {
    if (files.has(artifact.id)) { verifyBytes(artifact, files.get(artifact.id), true); verified.push(artifact.id); }
    else absent.push(artifact.id);
  }
  return freeze({ capsule, verified, absent, currentProjectVerified: false });
}
module.exports = { MANIFEST_VERSION, MAX_ARTIFACT_BYTES, classifyInput, admitCompletedBuild, verifyHistoricalArtifacts, validateAttribution };
