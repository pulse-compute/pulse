'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, relativePath, fail } = require('./data');
const { readFile, contained, stamp } = require('./files');
const MAX_FILES = 20000, MAX_BYTES = 256 * 1024 * 1024;
const ensure = (value, code = 'REPORT_INPUT_UNBOUND') => { if (!value) fail(code); };
function state(file) {
  const chain = []; let directory = path.parse(file).root;
  for (const part of path.relative(directory, file).split(path.sep)) {
    directory = path.join(directory, part);
    const s = fs.lstatSync(directory, { bigint: true });
    chain.push(s.isDirectory() ? [s.dev, s.ino, s.mode].map(String).join(':') : stamp(s));
  }
  return { real: fs.realpathSync(file), token: JSON.stringify(chain) };
}
function locate(root, file, workspace) {
  ensure(contained(workspace.root, file));
  let directory = root, up = 0;
  while (!contained(directory, file) && up < workspace.depth) { directory = path.dirname(directory); up++; }
  ensure(contained(directory, file));
  const relative = path.relative(directory, file).split(path.sep).join('/'); relativePath(relative);
  return { up, file: relative };
}
function resolve(root, location, workspace) {
  ensure(location && Object.keys(location).sort().join(',') === 'file,up');
  ensure(Number.isSafeInteger(location.up) && location.up >= 0 && location.up <= workspace.depth);
  relativePath(location.file);
  let directory = root;
  for (let i = 0; i < location.up; i++) directory = path.dirname(directory);
  const file = path.resolve(directory, location.file);
  ensure(contained(workspace.root, file));
  return file;
}
// Exact consumed inputs, never a scan of installed package contents. Root links
// are data: resolve and bind their targets without importing package code.
function readSourcesChecked(root, records, workspace) {
  ensure(Array.isArray(records) && records.length <= MAX_FILES, 'REPORT_LIMIT');
  const tokens = new Map(), files = new Map(); let bytes = 0;
  for (const row of records) {
    ensure(row && Object.keys(row).sort().join(',') === 'bytes,identity,kind,location,real,sha256');
    ensure(['source', 'source-link', 'manifest', 'missing-manifest'].includes(row.kind));
    ensure(typeof row.identity === 'string' && row.identity.length > 0);
    if (row.kind === 'source' || row.kind === 'source-link') { relativePath(row.identity); ensure(row.identity.startsWith('npm/')); }
    else ensure(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(row.identity));
    const file = resolve(root, row.location, workspace);
    const key = canonicalJson(row.location); ensure(!tokens.has(key));
    if (row.kind === 'missing-manifest') {
      ensure(row.real === null && row.bytes === 0 && row.sha256 === null);
      ensure(row.location.file.endsWith('/node_modules/' + row.identity + '/package.json')
        || row.location.file === 'node_modules/' + row.identity + '/package.json');
      try { fs.lstatSync(file); fail('REPORT_STALE_INPUTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      tokens.set(key, 'absent'); continue;
    }
    const real = resolve(root, row.real, workspace);
    const before = state(file); ensure(before.real === real, 'REPORT_STALE_INPUTS');
    if (row.kind === 'source-link') {
      ensure(row.bytes === 0 && row.sha256 === null && fs.statSync(real).isFile());
      tokens.set(key, before.token); continue;
    }
    ensure(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[a-f0-9]{64}$/.test(row.sha256));
    bytes += row.bytes; ensure(bytes <= MAX_BYTES, 'REPORT_LIMIT');
    const relative = path.relative(workspace.root, real).split(path.sep).join('/');
    const read = readFile(workspace.root, relative);
    ensure(read.size === row.bytes && read.sha256 === row.sha256, 'REPORT_STALE_INPUTS');
    if (row.kind === 'manifest') ensure(JSON.parse(read.bytes).name === row.identity);
    const after = state(file); ensure(before.real === after.real && before.token === after.token, 'REPORT_CONCURRENT_CHANGE');
    tokens.set(key, after.token); files.set(real, row);
  }
  return { records, tokens, files };
}
function readSources(root, records, workspace) {
  try { return readSourcesChecked(root, records, workspace); }
  catch (error) {
    if (error.code?.startsWith('REPORT_') && !['REPORT_PATH', 'REPORT_MISSING_ARTIFACT'].includes(error.code)) throw error;
    fail('REPORT_STALE_INPUTS');
  }
}
function captureSources(root, receipt, workspace) {
  if (receipt?.error) fail(receipt.error);
  const unique = new Map();
  for (const row of receipt?.rows || []) {
    const retained = { kind: row.kind, identity: row.identity, location: locate(root, row.file, workspace),
      real: row.real === null ? null : locate(root, row.real, workspace), bytes: row.bytes, sha256: row.sha256 };
    const key = canonicalJson(retained.location), prior = unique.get(key);
    ensure(!prior || prior.token === row.token && canonicalJson(prior.retained) === canonicalJson(retained), 'REPORT_CONCURRENT_CHANGE');
    unique.set(key, { retained, token: row.token });
  }
  const ordered = [...unique].sort(([a], [b]) => a < b ? -1 : 1);
  const snapshot = readSources(root, ordered.map(([, row]) => row.retained), workspace);
  for (const [key, row] of ordered) ensure(snapshot.tokens.get(key) === row.token, 'REPORT_CONCURRENT_CHANGE');
  return snapshot;
}
module.exports = { captureSources, readSources };
