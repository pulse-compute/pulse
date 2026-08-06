#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initProject } = require('../../packages/cli/src/project-execution.js');
const { repoRoot, run, parseJson, parseError } = require('./helpers.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function generatedSnapshot(root, files) {
  return Object.freeze(Object.fromEntries(files.map((file) => [file, sha256(path.join(root, file))])));
}

function verifyProject(root, expectedProvider) {
  const doctor = parseJson(run(['doctor', '--json'], root));
  assert.equal(doctor.status, 'passed');
  const inspect = parseJson(run(['inspect', '--json'], root));
  assert.equal(inspect.status, 'ok');
  assert.equal(inspect.project.workspace.kind, 'conventional');
  assert.equal(inspect.project.selectedProfile.name, 'local');
  assert.equal(inspect.project.provider, expectedProvider);
  assert.equal(inspect.compiler.authoring.kind, 'pulse');
  assert.equal(inspect.compiler.application.kind, 'pulse.application-ir');
  const tested = parseJson(run(['test', '--json'], root));
  assert.deepEqual(tested.summary, { total: 1, passed: 1, failed: 0 });
  const compiled = parseJson(run(['compile', '--out', '.pulse-compile', '--json'], root, { timeout: 180000 }));
  assert.equal(compiled.status, 'compiled');
  const built = parseJson(run(['build', '--out', 'dist', '--json'], root, { timeout: 180000 }));
  assert.equal(built.status, 'built');
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-init-workflow-'));
  try {
    const firstRoot = path.join(tmp, 'first');
    const secondRoot = path.join(tmp, 'second');
    const first = initProject(firstRoot, { name: '@example/generated' });
    const second = initProject(secondRoot, { name: '@example/generated' });
    const expectedFiles = [
      '.gitignore',
      '.pulse/.gitignore',
      '.pulse/config.ts',
      'README.md',
      'package.json',
      'src/index.ts',
      'tests/pulse.harness.ts',
      'tsconfig.json'
    ];
    assert.deepEqual(first.files, expectedFiles);
    assert.deepEqual(second.files, expectedFiles);
    assert.deepEqual(generatedSnapshot(firstRoot, first.files), generatedSnapshot(secondRoot, second.files));
    assert.deepEqual(first.nextSteps.slice(-2), ['npm install', 'npm run doctor']);
    assert.equal(fs.existsSync(path.join(firstRoot, 'pulse.config.ts')), false);
    assert.equal(fs.readFileSync(path.join(firstRoot, '.pulse', '.gitignore'), 'utf8'), '*\n!.gitignore\n!config.ts\n');

    const manifest = JSON.parse(fs.readFileSync(path.join(firstRoot, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies['@pulse-compute/pulse'], '1.0.0-beta.1');
    assert.equal(manifest.dependencies['@pulse-compute/runtime'], undefined);
    assert.equal(manifest.devDependencies['@pulse-compute/cli'], '1.0.0-beta.1');
    assert.deepEqual(Object.keys(manifest.scripts).sort(), ['build', 'compile', 'dev', 'doctor', 'inspect', 'test']);
    assert.match(fs.readFileSync(path.join(firstRoot, 'src', 'index.ts'), 'utf8'), /const app = new Pulse\(\{ auto: true \}\)/);
    assert.match(fs.readFileSync(path.join(firstRoot, 'src', 'index.ts'), 'utf8'), /app\.get\('\/health', async \(ctx\)/);
    assert.match(fs.readFileSync(path.join(firstRoot, '.pulse', 'config.ts'), 'utf8'), /strict: true/);
    assert.match(fs.readFileSync(path.join(firstRoot, 'tests', 'pulse.harness.ts'), 'utf8'), /name: 'health'/);
    verifyProject(firstRoot, 'node');

    const fastlyRoot = path.join(tmp, 'fastly');
    const fastly = initProject(fastlyRoot, { provider: 'fastly', name: 'fastly-generated' });
    assert.deepEqual(fastly.files, expectedFiles);
    const fastlyManifest = JSON.parse(fs.readFileSync(path.join(fastlyRoot, 'package.json'), 'utf8'));
    assert.equal(fastlyManifest.dependencies['@pulse-compute/provider-fastly'], '1.0.0-beta.1');
    assert.match(fs.readFileSync(path.join(fastlyRoot, '.pulse', 'config.ts'), 'utf8'), /host: 'fastly'/);
    assert.match(fs.readFileSync(path.join(fastlyRoot, '.pulse', 'config.ts'), 'utf8'), /bindings:/);
    verifyProject(fastlyRoot, 'fastly');

    const occupied = path.join(tmp, 'occupied');
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, 'keep.txt'), 'keep');
    const result = run(['init', occupied, '--json'], repoRoot);
    const error = parseError(result);
    assert.equal(error.error.code, 'PULSE_INIT_NOT_EMPTY');

    console.log('ok - pulse init deterministically creates a conventional async Pulse project and clean Node/Fastly source candidates');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
