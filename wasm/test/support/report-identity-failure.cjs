'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Capture these bytes at task entry, before fixture writes. One entry record
// survives timeouts; at most one failure record adds the terminal phase.
// Expected schema/negative-test errors never enter this observation stream.
module.exports = function failureEvidence(testFile, cli, write = line => console.error(line)) {
  const root = path.resolve(__dirname, '../../..');
  const files = [
    testFile, __filename,
    path.join(root, 'wasm/scripts/run-wasm-tests.cjs'),
    path.join(root, 'wasm/test/suite/registry.cjs'),
    path.join(root, 'scripts/source-identity.cjs'),
    ...['files', 'snapshot', 'source-inputs', 'retained', 'identity-diagnostic']
      .map(name => path.join(cli, 'internal/report', name + '.js'))
  ].map(file => {
    let sha256 = null;
    try { sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { /* Record unavailable, not a substitute identity. */ }
    return { file: file.startsWith(root + path.sep) ? path.relative(root, file).split(path.sep).join('/')
      : 'installed-cli/' + path.relative(cli, file).split(path.sep).join('/'), sha256 };
  });
  const revision = process.env.PULSE_SOURCE_REVISION;
  const context = { kind: 'pulse.report-identity-observation', version: 1,
      task: path.basename(testFile), node: process.version, platform: process.platform, arch: process.arch,
      sourceRevision: /^[a-f0-9]{40}$/.test(revision || '') ? revision : null,
      // File hashes are the observed owners; revision alone does not certify a clean tree.
      files };
  write(JSON.stringify({ ...context, status: 'started' }));
  let phase = 'setup', emitted = false;
  function emit(error) {
    if (emitted) return;
    emitted = true;
    write(JSON.stringify({ ...context, status: 'failed', phase,
      code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : null }));
  }
  emit.phase = value => { phase = value; };
  return emit;
};
