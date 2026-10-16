#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { containedFile, loadEvidence, render, updateDocument } = require('./results.cjs');
const pin = require('./baseline.json');

assert.equal(process.argv.length, 3, 'Usage: node results-checks.cjs /path/to/extracted-evidence');
const original = fs.realpathSync(process.argv[2]);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'perf9-results-checks-'));
let checks = 0;
try {
  const evidence = loadEvidence(original);
  const expected = render(evidence);
  const document = fs.readFileSync(path.join(__dirname, 'RESULTS.md'), 'utf8');
  assert.equal(updateDocument(document, expected), document);
  checks++;

  // Relocation must work without using the original absolute paths in any report.
  const relocated = path.join(temporary, 'evidence');
  fs.cpSync(original, relocated, { recursive: true });
  assert.equal(render(loadEvidence(relocated)), expected);
  checks++;

  function rejectedEdit(relative, edit, message) {
    const file = path.join(relocated, relative), bytes = fs.readFileSync(file);
    try {
      edit(file, bytes);
      assert.throws(() => loadEvidence(relocated), message);
      checks++;
    } finally { fs.writeFileSync(file, bytes); }
  }
  const flipByte = (file, bytes) => { const altered = Buffer.from(bytes); altered[0] ^= 1; fs.writeFileSync(file, altered); };
  rejectedEdit(pin.measurement, flipByte, /Evidence hash mismatch/);
  rejectedEdit('pulse/wasm/.test-results/perf9-01b-EMEss3/pulse/main.wasm', flipByte, /Evidence hash mismatch/);
  rejectedEdit('manifest.json', (file, bytes) => fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from(' ')])), /Frozen manifest hash mismatch/);
  const rebuild = evidence.qualification.rebuild.rust.file;
  const rebuildEntry = evidence.manifest.files.find(entry => entry.originalPath === rebuild);
  assert(rebuildEntry, 'Rebuild artifact must be archived');
  rejectedEdit(rebuildEntry.archivePath, file => fs.unlinkSync(file), /ENOENT/);

  assert.throws(() => containedFile(relocated, '../outside'), /Unsafe archive path/);
  const outside = path.join(temporary, 'outside');
  fs.writeFileSync(outside, 'not evidence');
  fs.symlinkSync(outside, path.join(relocated, 'escaped'));
  assert.throws(() => containedFile(relocated, 'escaped'), /Evidence path escapes root/);
  checks++;

  const alteredTable = document.replace('| 2.320 / 1.921 |', '| 999.000 / 1.921 |');
  assert.notEqual(alteredTable, document, 'Expected frozen latency row');
  assert.notEqual(updateDocument(alteredTable, expected), alteredTable);
  assert.throws(() => updateDocument('missing markers', expected), /start marker/);
  checks++;

  const badArgs = spawnSync(process.execPath, [path.join(__dirname, 'results.cjs'), '--unknown', relocated], { encoding: 'utf8' });
  assert.equal(badArgs.status, 1);
  assert.match(badArgs.stderr, /Usage:/);
  checks++;
  console.log(`ok - PERF9-01C: ${checks} replay checks passed (relocation, corruption, missing artifact, containment, table drift and CLI failure)`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
