#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');
const { createCapsule, serializeCapsule, serializeStoredCapsule, parseCapsule } = require(path.join(f.reportRoot, 'capsule'));
const { compareCapsules, serializeComparison, parseComparison } = require(path.join(f.reportRoot, 'comparison'));
const { renderComparison } = require(path.join(f.reportRoot, 'comparison-viewer'));
const cli = path.resolve(__dirname, '../../packages/cli');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse compare '));
let checks = 0;
function child(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, ...options });
  assert.ifError(result.error); return result;
}

try {
  // Exercise actual packed payloads outside the checkout, with the existing
  // pure contracts dependency but no compiler/provider or workspace links.
  const installed = path.join(temporary, 'consumer/node_modules/@pulse-compute/cli');
  for (const [name, source] of [['cli', cli], ['wasm-contracts', path.resolve(cli, '../contracts')]]) {
    const pack = child(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: source });
    assert.equal(pack.status, 0, pack.stderr);
    const archive = path.join(temporary, JSON.parse(pack.stdout)[0].filename);
    const destination = path.join(temporary, 'consumer/node_modules/@pulse-compute', name);
    fs.mkdirSync(destination, { recursive: true });
    const unpack = child('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
    assert.equal(unpack.status, 0, unpack.stderr);
  }
  const cwd = path.join(temporary, 'hostile project with spaces');
  fs.mkdirSync(path.join(cwd, '.pulse'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), "throw Error('CONFIG_EXECUTED');");
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"type":"module"}');
  const guard = path.join(temporary, 'passive guard.cjs');
  fs.writeFileSync(guard, `const M=require('node:module'),load=M._load;
M._load=function(id,...args){if(/project-config|project-execution|compiler|provider-|typescript|child_process|^(node:)?(http|https|http2|net|tls|dns|dgram)$/.test(id)){process.stderr.write('FORBIDDEN_IMPORT:'+id+'\\n');throw Error('FORBIDDEN_IMPORT:'+id);}return load.call(this,id,...args);};
global.fetch=()=>{throw Error('FORBIDDEN_NETWORK');};`);
  const env = { ...process.env, NODE_OPTIONS: '--require=' + JSON.stringify(guard), PULSE_PROFILE: 'must-not-load' };
  delete env.NODE_PATH;
  function run(args, status = 0, extraEnv = {}) {
    const result = child(process.execPath, [path.join(installed, 'bin/pulse.js'), 'compare', ...args], { cwd, env: { ...env, ...extraEnv } });
    assert.equal(result.status, status, result.stderr);
    assert.equal(status ? result.stdout : result.stderr, ''); checks++;
    return status ? result.stderr : result.stdout;
  }
  function reject(args, code, status = 3) {
    const error = JSON.parse(run([...args, '--json'], status)).error;
    assert.equal(error.code, code); assert.equal(error.scope, 'public');
    assert(error.docs.endsWith('#' + code.toLowerCase().replaceAll('_', '-')));
  }
  const before = createCapsule(f.fixture()), value = f.fixture();
  value.application.name = '<script>\x1b]52;c;canary\x07';
  value.routes[0].path = '/changed';
  const after = createCapsule(value);
  // Different input directories, normalized and expanded storage, and spaces.
  const beforeFile = path.join(temporary, 'before capsule.json'), afterFile = path.join(cwd, 'after.json');
  fs.writeFileSync(beforeFile, serializeStoredCapsule(before));
  fs.writeFileSync(afterFile, serializeCapsule(after));
  const args = [beforeFile, 'after.json'];
  const beforeBytes = fs.readFileSync(beforeFile), afterBytes = fs.readFileSync(afterFile);
  const expected = compareCapsules(parseCapsule(beforeBytes), parseCapsule(afterBytes));
  assert.equal(run(args), serializeComparison(expected));
  assert.equal(run([...args, '--json']), serializeComparison(expected));
  assert.equal(run(['--json', ...args]), serializeComparison(expected));
  assert(run(['--help']).includes('pulse compare <before.json> <after.json>'));
  for (const flag of ['--plan', '--dry-run']) {
    const planned = JSON.parse(run(['missing-before.json', 'missing-after.json', flag, '--json']));
    assert.equal(planned.plan.command, 'compare'); assert.equal(planned.plan.build, false);
    run([...args, '--html', flag]);
    assert(!fs.existsSync(path.join(cwd, '.pulse/reports')));
  }
  const out = run([...args, '--html', '--out', 'review folder/compare.html']).trim();
  const html = fs.readFileSync(out, 'utf8');
  assert(html === renderComparison(expected), 'installed HTML matches the shared renderer for the same admitted inputs');
  assert.deepEqual(parseComparison(html.match(/<script id="pulse-comparison-data" type="application\/json">([\s\S]*?)<\/script>/)[1]), expected);
  assert.equal(run([...args, '--html', '--out', 'review folder/compare.html']).trim(), out);
  assert.equal(fs.readFileSync(out, 'utf8'), html);
  assert(run([...args, '--html']).trim().endsWith(path.join('.pulse/reports', 'pulse-comparison.html')));

  // Different contexts are a valid, qualified comparison, not a failed build.
  const incompatible = f.fixture(); incompatible.context.host = 'fastly'; incompatible.artifacts.forEach(row => { row.host = 'fastly'; });
  fs.writeFileSync(afterFile, serializeCapsule(createCapsule(incompatible)));
  const compared = JSON.parse(run([...args, '--json']));
  assert.equal(compared.compatibility.status, 'incompatible');
  assert.equal(compared.summary.artifactBytes.delta, null);
  fs.writeFileSync(afterFile, afterBytes);
  reject([], 'PULSE_ARGUMENT_MISSING', 2);
  reject([beforeFile], 'PULSE_ARGUMENT_MISSING', 2);
  for (const extra of [['extra.json'], ['--html'], ['--out', 'view.html'], ['--profile', 'native'], ['--artifact', 'after.json']]) {
    reject([...args, ...extra], 'PULSE_ARGUMENT_UNEXPECTED', 2);
  }
  reject(['missing.json', 'after.json'], 'PULSE_REPORT_EVIDENCE_MISSING');
  const invalidFile = path.join(cwd, 'invalid.json');
  for (const invalid of ['{', JSON.stringify({ ...after, application: { name: 'tampered' } })]) {
    fs.writeFileSync(invalidFile, invalid); reject([beforeFile, 'invalid.json'], 'PULSE_REPORT_INPUT_INVALID');
  }
  fs.writeFileSync(invalidFile, JSON.stringify(f.completed().manifest));
  reject([beforeFile, 'invalid.json'], 'PULSE_REPORT_INCOMPATIBLE');
  fs.writeFileSync(invalidFile, JSON.stringify({ ...after, reportVersion: 999 }));
  reject([beforeFile, 'invalid.json'], 'PULSE_REPORT_INCOMPATIBLE');
  const inputHtml = path.join(cwd, 'input.html'); fs.writeFileSync(inputHtml, afterBytes);
  assert(run([beforeFile, 'input.html', '--html', '--out', 'input.html'], 2).includes('PULSE_REPORT_OUTPUT_UNSAFE'));
  for (const destination of ['../escape.html', afterFile, 'bad.txt', 'bad\nname.html', path.join(temporary, 'escape.html')]) {
    assert(run([...args, '--html', '--out', destination], 2).includes('PULSE_REPORT_OUTPUT_UNSAFE'));
  }
  fs.symlinkSync(temporary, path.join(cwd, 'link'));
  assert(run([...args, '--html', '--out', 'link/escape.html'], 2).includes('PULSE_REPORT_OUTPUT_UNSAFE'));
  fs.symlinkSync(afterFile, path.join(cwd, 'linked.json'));
  reject([beforeFile, 'linked.json'], 'PULSE_REPORT_INPUT_INVALID');

  // Exercise the installed command's output error mapping and atomic cleanup.
  const fault = path.join(temporary, 'write fault.cjs');
  fs.writeFileSync(fault, "require('node:fs').renameSync=()=>{throw Error('PRIVATE_WRITE_FAILURE');};");
  const failure = run([...args, '--html', '--out', 'review folder/compare.html'], 3,
    { NODE_OPTIONS: env.NODE_OPTIONS + ' --require=' + JSON.stringify(fault) });
  assert(failure.includes('PULSE_REPORT_OUTPUT_FAILED')); assert(!failure.includes('PRIVATE_WRITE_FAILURE'));
  assert.equal(fs.readFileSync(out, 'utf8'), html);
  assert.deepEqual(fs.readdirSync(path.dirname(out)).sort(), ['.pulse-report-outputs', 'compare.html']);
  assert.deepEqual(fs.readFileSync(beforeFile), beforeBytes);
  assert.deepEqual(fs.readFileSync(afterFile), afterBytes);
  assert.deepEqual(fs.readFileSync(inputHtml), afterBytes);
  console.log(`ok - public compare from packed CLI: JSON/HTML parity, passive replay, compatibility, diagnostics and safe output (${checks} invocations)`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
