'use strict';

// Internal build-time resource admission, not a public authoring/runtime API.
// Explicit byte inputs only: no filesystem, network, or host discovery.
const { createHash } = require('node:crypto');
const { VERSION, assetPath, validateEmbeddedManifest } = require('../assets/embedded-manifest.js');
const RESOURCE_CATALOGUE_VERSION = 'pulse.binary-resource-catalogue.v1';
const admittedCatalogues = new WeakSet();
const BUDGET_FIELDS = Object.freeze(['files', 'fileBytes', 'totalBytes', 'serializedBytes', 'bindings']);
const PATH_BYTES = 1024; // Shared manifest path grammar, not a payload ceiling.
const hash = value => createHash('sha256').update(value).digest('hex');
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const byteOffset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset').get;
const buffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;

function fail(reason) {
  // This internal reason is deliberately bounded and contains no supplied data.
  throw Object.assign(new TypeError(`Binary resource admission failed: ${reason}.`), { reason });
}
function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('shape');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !allowed.includes(key)
    || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))
    || required.some(key => !Object.hasOwn(fields, key))) fail('shape');
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function denseArray(value, maximum, reason) {
  if (!Array.isArray(value) || value.length > maximum) fail(reason);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('shape');
  }
}
function normalizeResourceBudgets(input) {
  record(input, BUDGET_FIELDS);
  const result = {};
  for (const field of BUDGET_FIELDS) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) fail('budget');
    result[field] = input[field];
  }
  return Object.freeze(result);
}
function validId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(id)) fail('logical-id');
  return id;
}
const manifestIdentity = files => hash(JSON.stringify([VERSION,
  files.map(file => [file.path, file.contentType, file.byteLength, file.sha256])]));

function createResourceManifest(inputs, suppliedBudgets) {
  const budgets = normalizeResourceBudgets(suppliedBudgets);
  denseArray(inputs, budgets.files, 'file-count');
  const paths = new Set();
  let total = 0;
  // Validate all descriptors and serialized size before allocating private bytes
  // or base64 strings. Metadata-only skeletons account for JSON escaping exactly.
  const entries = inputs.map(input => {
    record(input, ['path', 'bytes', 'contentType'], ['path', 'bytes']);
    const path = assetPath(input.path, { pathBytes: PATH_BYTES }, () => fail('path'));
    if (paths.has(path)) fail('duplicate-path');
    paths.add(path);
    if (!(input.bytes instanceof Uint8Array)) fail('bytes');
    // Read intrinsic view metadata; a subclass cannot lie about admitted size.
    let bytes;
    try { bytes = new Uint8Array(buffer.call(input.bytes), byteOffset.call(input.bytes), byteLength.call(input.bytes)); }
    catch { fail('bytes'); }
    if (bytes.byteLength > budgets.fileBytes) fail('file-bytes');
    if (bytes.byteLength > budgets.totalBytes - total) fail('total-bytes');
    total += bytes.byteLength;
    const contentType = input.contentType ?? 'application/octet-stream';
    if (typeof contentType !== 'string' || !/^[\x20-\x7e]{1,128}$/.test(contentType) || contentType.trim() !== contentType) fail('content-type');
    return { path, bytes, byteLength: bytes.byteLength, contentType };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const skeleton = { version: VERSION, id: '0'.repeat(64), byteLength: total,
    files: entries.map(entry => ({ path: entry.path, data: '', byteLength: entry.byteLength,
      sha256: '0'.repeat(64), contentType: entry.contentType })) };
  let serializedBytes = Buffer.byteLength(JSON.stringify(skeleton));
  if (serializedBytes > budgets.serializedBytes) fail('serialized-bytes');
  for (const entry of entries) {
    const encodedBytes = 4 * Math.ceil(entry.byteLength / 3);
    if (encodedBytes > budgets.serializedBytes - serializedBytes) fail('serialized-bytes');
    serializedBytes += encodedBytes;
  }
  const files = entries.map(entry => {
    const bytes = Buffer.from(entry.bytes); // Snapshot; never retain caller-owned memory.
    return { path: entry.path, data: bytes.toString('base64'), byteLength: bytes.length,
      sha256: hash(bytes), contentType: entry.contentType };
  });
  return freeze({ version: VERSION, id: manifestIdentity(files), byteLength: total, files });
}

function admitResourceCatalogue(serialized, declarations, suppliedBudgets) {
  const budgets = normalizeResourceBudgets(suppliedBudgets);
  denseArray(declarations, budgets.bindings, 'binding-count');
  // No selected-entry shortcut: corruption in unused records is still rejected.
  const manifest = validateEmbeddedManifest(serialized, { ...budgets, pathBytes: PATH_BYTES }, () => fail('manifest'));
  const files = new Map(manifest.files.map(file => [file.path, file]));
  const ids = new Set(), blobs = new Map();
  const records = declarations.map(declaration => {
    record(declaration, ['id', 'path']);
    const id = validId(declaration.id);
    if (ids.has(id)) fail('duplicate-id');
    ids.add(id);
    const file = files.get(assetPath(declaration.path, { pathBytes: PATH_BYTES }, () => fail('path')));
    if (!file) fail('missing');
    const blobId = `${file.sha256}:${file.byteLength}`;
    if (!blobs.has(blobId)) blobs.set(blobId, { id: blobId, byteLength: file.byteLength, sha256: file.sha256, data: file.data });
    return { id, path: file.path, byteLength: file.byteLength, sha256: file.sha256, blobId };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const identity = hash(JSON.stringify([RESOURCE_CATALOGUE_VERSION, manifest.id,
    records.map(entry => [entry.id, entry.path, entry.byteLength, entry.sha256])]));
  const sortedBlobs = [...blobs.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const catalogue = freeze({ version: RESOURCE_CATALOGUE_VERSION, identity, manifestId: manifest.id, budgets,
    records, blobs: sortedBlobs,
    source: { recordCount: manifest.files.length, decodedBytes: manifest.byteLength, serializedBytes: Buffer.byteLength(serialized) },
    backingBytes: sortedBlobs.reduce((sum, blob) => sum + blob.byteLength, 0) });
  admittedCatalogues.add(catalogue);
  return catalogue;
}

// The compiler/package path owns catalogue payloads. Reports receive only this
// explicit projection; JSON serialization of a catalogue is NOT a report API.
function resourceCatalogueSummary(catalogue) {
  if (!admittedCatalogues.has(catalogue)) fail('catalogue');
  return freeze({ version: catalogue.version, identity: catalogue.identity, manifestId: catalogue.manifestId,
    budgets: { ...catalogue.budgets }, source: { ...catalogue.source },
    bindingCount: catalogue.records.length, uniqueBackingCount: catalogue.blobs.length,
    backingBytes: catalogue.backingBytes,
    records: catalogue.records.map(({ id, byteLength, sha256, blobId }) => ({ id, byteLength, sha256, blobId })) });
}

module.exports = { RESOURCE_CATALOGUE_VERSION, normalizeResourceBudgets,
  createResourceManifest, admitResourceCatalogue, resourceCatalogueSummary };
