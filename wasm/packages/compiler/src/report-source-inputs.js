'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const reads = new WeakMap(), outputs = new WeakMap();
const stamp = s => (s.isDirectory() ? [s.dev, s.ino, s.mode] : [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs]).map(String).join(':');
// In-memory read receipts only: never enter the graph, plan or executable hashes.
function state(file) {
  const chain = []; let directory = path.parse(file).root;
  for (const part of path.relative(directory, file).split(path.sep)) {
    directory = path.join(directory, part); chain.push(stamp(fs.lstatSync(directory, { bigint: true })));
  }
  return { real: fs.realpathSync(file), token: JSON.stringify(chain) };
}
function receiptFor(owner) {
  if (!reads.has(owner)) reads.set(owner, { rows: [], error: null, bytes: 0 });
  return reads.get(owner);
}
function readSourceInput(owner, file, kind, identity) {
  const receipt = receiptFor(owner);
  let before; try { before = state(file); } catch { receipt.error = 'REPORT_INPUT_UNBOUND'; }
  const source = fs.readFileSync(file, 'utf8'); // Preserve the compiler's ordinary read/error behavior.
  try {
    const after = state(file), bytes = Buffer.byteLength(source);
    if (!before || before.real !== after.real || before.token !== after.token) receipt.error = 'REPORT_CONCURRENT_CHANGE';
    receipt.bytes += bytes;
    if (receipt.rows.length >= 20000 || receipt.bytes > 256 * 1024 * 1024) receipt.error = 'REPORT_LIMIT';
    if (!receipt.error) receipt.rows.push(Object.freeze({ file, ...after, kind, identity, bytes,
      sha256: createHash('sha256').update(source).digest('hex') }));
  } catch { receipt.error = 'REPORT_INPUT_UNBOUND'; }
  return source;
}
function missingManifest(owner, file, identity) {
  if (!owner) return;
  const receipt = receiptFor(owner);
  if (receipt.rows.length >= 20000) receipt.error = 'REPORT_LIMIT';
  if (!receipt.error) receipt.rows.push(Object.freeze({ file, real: null, token: 'absent', kind: 'missing-manifest', identity, bytes: 0, sha256: null }));
}
function sourceResolution(owner, file, real, identity) {
  if (!owner || file === real) return;
  const receipt = receiptFor(owner);
  try {
    const observed = state(file);
    if (observed.real !== real) receipt.error = 'REPORT_CONCURRENT_CHANGE';
    if (receipt.rows.length >= 20000) receipt.error = 'REPORT_LIMIT';
    if (!receipt.error) receipt.rows.push(Object.freeze({ file, ...observed, kind: 'source-link', identity, bytes: 0, sha256: null }));
  } catch { receipt.error = 'REPORT_INPUT_UNBOUND'; }
}
function retainSourceInputs(compiled, context) {
  const receipt = reads.get(context);
  outputs.set(compiled, Object.freeze({ rows: Object.freeze([...(receipt?.rows || [])]), error: receipt?.error || null }));
}
function sourceInputsForCompiled(compiled) { return outputs.get(compiled); }
module.exports = { readSourceInput, missingManifest, sourceResolution, retainSourceInputs, sourceInputsForCompiled };
