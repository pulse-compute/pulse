'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-bootstrap-test-'));
try {
  const bin = path.join(temporary, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(temporary, 'npm-calls.jsonl');
  const npm = execFileSync('bash', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  // Fail before any registry operation; real local pack still proves the bytes.
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] !== 'pack' || !args.includes('--ignore-scripts')) process.exit(99);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
const result = spawnSync(${JSON.stringify(npm)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 98);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  const output = path.join(temporary, 'prepared');
  const prepare = (name, destination) => spawnSync('bash', ['scripts/npm_bootstrap.sh', '--prepare-only', name, destination],
    { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const result = prepare('@pulse-compute/mcp', output);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const files = fs.readdirSync(output);
  assert.deepEqual(files, ['pulse-compute-mcp-0.0.0.tgz']);
  const entries = readTarEntries(path.join(output, files[0]));
  assert.deepEqual([...entries.keys()].sort(), ['LICENSE', 'NOTICE', 'README.md', 'package.json'].map(file => 'package/' + file).sort());
  const manifest = JSON.parse(entries.get('package/package.json'));
  assert.equal(manifest.name, '@pulse-compute/mcp');
  assert.equal(manifest.version, '0.0.0');
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/', tag: 'bootstrap' });
  for (const key of ['main', 'module', 'types', 'exports', 'bin', 'scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(manifest[key], undefined, `Bootstrap must be inert: ${key}`);
  }
  for (const file of ['LICENSE', 'NOTICE']) assert.deepEqual(entries.get('package/' + file), fs.readFileSync(path.join(root, file)));
  assert.match(entries.get('package/README.md').toString(), /no runtime or API/);
  const before = fs.readFileSync(calls, 'utf8');
  assert.equal(before.trim().split('\n').length, 2, 'Only dry-run and actual local packing');
  assert.notEqual(prepare('@pulse-compute/mcp', output).status, 0, 'Never overwrite prepared artifacts');
  assert.notEqual(prepare('@pulse-compute/INVALID', path.join(temporary, 'invalid')).status, 0);
  assert.equal(fs.readFileSync(calls, 'utf8'), before, 'Rejected requests must not invoke npm');
  console.log('ok - prepare-only bootstrap is inert, preserves legal bytes, refuses overwrites and never contacts or mutates the registry');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
