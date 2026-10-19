'use strict';
// One fresh process per sample. RSS is process-wide, not guest/live heap usage.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { hash } = require('./model.cjs');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (global.gc) global.gc();
const before = process.memoryUsage();
let owner, view, artifact, instance;
if (job.mode.startsWith('native-')) {
  artifact = fs.readFileSync(job.wasm);
  assert.equal(hash(artifact), job.wasmSha256);
  instance = new WebAssembly.Instance(new WebAssembly.Module(artifact));
  if (job.mode === 'native-host-copy') {
    owner = Uint8Array.from(fs.readFileSync(job.bytes));
    assert.equal(hash(owner), job.sha256);
    const pointer = instance.exports.prepare();
    new Uint8Array(instance.exports.memory.buffer, pointer, owner.length).set(owner);
  }
  const token = instance.exports.begin();
  assert.equal(instance.exports.checksum(token), job.checksum);
  assert.equal(instance.exports.last_error(), 0);
  const capacity = instance.exports.memory.buffer.byteLength;
  if (job.byteLength) instance.exports.repeat(token, 100000);
  assert.equal(instance.exports.last_error(), 0);
  assert.equal(instance.exports.memory.buffer.byteLength, capacity);
} else {
  if (job.mode === 'javascript-embedded') {
    artifact = fs.readFileSync(job.manifest, 'utf8');
    const entry = JSON.parse(artifact).files[0];
    owner = Uint8Array.from(Buffer.from(entry.data, 'base64'));
    assert.equal(hash(owner), job.sha256);
  } else {
    artifact = fs.readFileSync(job.bytes);
    assert.equal(hash(artifact), job.sha256);
    // Packaged files and host buffers both require a private snapshot in this model.
    owner = Uint8Array.from(artifact);
  }
  view = new DataView(owner.buffer, owner.byteOffset, owner.byteLength);
  let checksum = 0;
  for (let i = 0; i < owner.length; i++) checksum = (checksum + view.getUint8(i)) >>> 0;
  assert.equal(checksum, job.checksum);
}
// Retain inputs and owned state intentionally, including serialized embedded data.
global.retained = { owner, view, artifact, instance };
const loaded = process.memoryUsage();
if (global.gc) global.gc();
const retained = process.memoryUsage();
console.log(JSON.stringify({ mode: job.mode, byteLength: job.byteLength, before, loaded, retained,
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  guestCapacityBytes: instance?.exports.memory.buffer.byteLength ?? null,
  ownedDataBytes: owner?.byteLength ?? 0, forcedGc: !!global.gc, status: 'passed' }));
