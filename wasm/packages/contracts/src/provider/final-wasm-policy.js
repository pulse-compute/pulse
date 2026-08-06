'use strict';

const crypto = require('node:crypto');

const FINAL_WASM_POLICY_VERSION = 'pulse.final-wasm-policy.v1';

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableObject(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject(value))).digest('hex');
}

function string(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function surface(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  const seen = new Set();
  return Object.freeze(values.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`${field}[${index}] must be an object.`);
    const normalized = Object.freeze({
      module: entry.module === undefined ? undefined : string(entry.module, `${field}[${index}].module`),
      name: string(entry.name, `${field}[${index}].name`),
      kind: string(entry.kind, `${field}[${index}].kind`)
    });
    const key = `${normalized.module || ''}\0${normalized.name}\0${normalized.kind}`;
    if (seen.has(key)) throw new TypeError(`${field} contains duplicate surface ${normalized.name}.`);
    seen.add(key);
    return normalized;
  }).sort((left, right) => (
    String(left.module || '').localeCompare(String(right.module || ''))
    || left.name.localeCompare(right.name)
    || left.kind.localeCompare(right.kind)
  )));
}

function defineFinalWasmPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Final Wasm policy must be an object.');
  if (input.version !== FINAL_WASM_POLICY_VERSION) throw new TypeError(`Final Wasm policy must use ${FINAL_WASM_POLICY_VERSION}.`);
  const descriptor = Object.freeze({
    version: FINAL_WASM_POLICY_VERSION,
    descriptorOwner: string(input.descriptorOwner, 'descriptorOwner'),
    toolchainVersion: string(input.toolchainVersion, 'toolchainVersion'),
    descriptorIdentity: string(input.descriptorIdentity, 'descriptorIdentity'),
    permittedImports: surface(input.permittedImports, 'permittedImports'),
    requiredExports: surface(input.requiredExports, 'requiredExports'),
    featureBaseline: 'mvp',
    allowedFeatures: Object.freeze([]),
    memory: Object.freeze({ minimum: 1, maximum: 1, imported: 0, growable: false }),
    start: 'forbidden'
  });
  return Object.freeze({ ...descriptor, descriptorSha256: sha256(descriptor) });
}

function projectFinalWasmPolicy(policy, imports) {
  const descriptor = defineFinalWasmPolicy(policy);
  const allowedImports = surface(imports, 'observed final Wasm imports');
  const permitted = new Set(descriptor.permittedImports.map((entry) => `${entry.module}\0${entry.name}\0${entry.kind}`));
  const rejected = allowedImports.filter((entry) => !permitted.has(`${entry.module}\0${entry.name}\0${entry.kind}`));
  if (rejected.length > 0) throw new TypeError(`Final Wasm imports exceed the ${descriptor.descriptorIdentity} policy ceiling.`);
  return Object.freeze({
    descriptorOwner: descriptor.descriptorOwner,
    toolchainVersion: descriptor.toolchainVersion,
    descriptorIdentity: descriptor.descriptorIdentity,
    descriptorSha256: descriptor.descriptorSha256,
    allowedImports,
    requiredExports: descriptor.requiredExports.map(({ name, kind }) => Object.freeze({ name, kind })),
    featureBaseline: descriptor.featureBaseline,
    allowedFeatures: descriptor.allowedFeatures,
    memory: descriptor.memory,
    start: descriptor.start
  });
}

module.exports = Object.freeze({
  FINAL_WASM_POLICY_VERSION,
  defineFinalWasmPolicy,
  projectFinalWasmPolicy
});
