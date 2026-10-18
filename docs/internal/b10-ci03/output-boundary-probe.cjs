'use strict';
// Demonstrate why inspection facts alone are not an exact invocation result.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || process.cwd());
const hash = b => createHash('sha256').update(b).digest('hex');
const { inspectWasmFile } = require(path.join(root, 'wasm/packages/wasm-guest-link/src/inspect.js'));
const file = path.join(root, 'packages/crypto/guests/es256-rustcrypto/prebuilt/es256-verifier.wasm');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-inspection-output-probe-'));
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  inputSha256: hash(fs.readFileSync(file)), probeSha256: hash(fs.readFileSync(__filename)) };
try {
  const first = path.join(temporary, 'first'), second = path.join(temporary, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  const a = inspectWasmFile(file, { label: 'same', workDirectory: first });
  const obstruction = path.join(second, 'same-feature-check.wasm'); fs.mkdirSync(obstruction);
  let rejected;
  assert.throws(() => inspectWasmFile(file, { label: 'same', workDirectory: second }), error => {
    rejected = error.code; return Boolean(error.code);
  });
  fs.rmdirSync(obstruction);
  const b = inspectWasmFile(file, { label: 'same', workDirectory: second });
  assert.deepEqual(a, b);
  assert.equal(a.sha256, report.inputSha256);
  report.status = 'passed'; report.factsSha256 = hash(JSON.stringify(a));
  report.calls = ['successful', rejected, 'successful-after-removing-output-obstruction'];
  report.finding = 'Identical guest bytes and label can fail at a distinct output directory. Returning prior facts without preserving output/error behavior would hide that failure.';
} finally { fs.rmSync(temporary, { recursive: true, force: true }); report.cleaned = !fs.existsSync(temporary); }
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
