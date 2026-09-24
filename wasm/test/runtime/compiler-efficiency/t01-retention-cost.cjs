#!/usr/bin/env node
'use strict';

// Serial, fresh-process comparisons of the same source and compiler recipe.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile.js');
const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization.js');
const root = path.resolve(__dirname, '../../../..');
const transformFile = path.join(root, 'wasm/packages/build-support/src/native-retention-transform.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function sourceFor(count, stride) {
  const lines = ["@external('env', 'tap') declare function tap(value: i32): i32;"];
  for (let index = 0; index < count; index++) {
    lines.push(`${index % stride === 0 ? '@noinline ' : ''}function __pulse_expr_${index}(value: i32): i32 { return tap(value + ${index}) + ${index}; }`);
  }
  const chunks = Math.ceil(count / 64);
  for (let chunk = 0; chunk < chunks; chunk++) {
    lines.push(`@noinline function __pulse_chunk_${chunk}(value: i32): i32 { let result = 0;`);
    for (let index = chunk * 64; index < Math.min(count, (chunk + 1) * 64); index++) lines.push(`result += __pulse_expr_${index}(value);`);
    lines.push('return result; }');
  }
  lines.push('export function run(value: i32): i32 { let result = 0;');
  for (let chunk = 0; chunk < chunks; chunk++) lines.push(`result += __pulse_chunk_${chunk}(value);`);
  lines.push('return result; }');
  return lines.join('\n');
}

function writeProfiler(directory, baseline) {
  // Retain the previous per-name algorithm only as an evidence comparator.
  const method = baseline ? `
    const previous = this.binaryen.getPassArgument('no-inline');
    try {
      for (const name of this.retainedNames) {
        if (!module.getFunction(name)) continue;
        this.binaryen.setPassArgument('no-inline', name);
        module.runPasses(['no-inline']);
      }
    } finally { this.binaryen.setPassArgument('no-inline', previous); }
  ` : 'super.afterCompile(module);';
  fs.writeFileSync(path.join(directory, 'profile.cjs'), `
const fs = require('node:fs');
const Base = require(${JSON.stringify(transformFile)});
module.exports = class extends Base {
  afterCompile(module) {
    const started = process.hrtime.bigint();
    let passes = 0;
    const original = module.runPasses;
    module.runPasses = function (...args) { passes++; return original.apply(this, args); };
    try { ${method} } finally { module.runPasses = original; }
    fs.writeFileSync('retention.json', JSON.stringify({
      selected: this.retainedNames.length, passes, compilerPid: process.pid,
      retentionMs: Number(process.hrtime.bigint() - started) / 1e6
    }));
  }
};
`);
  fs.writeFileSync(path.join(directory, 'usage.cjs'), `
process.once('exit', () => require('node:fs').writeFileSync('usage.json', JSON.stringify({
  compilerMaxRssBytes: process.resourceUsage().maxRSS * 1024, compilerPid: process.pid
})));
`);
}

function compile(directory, source, baseline, count, asc) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'canonical-native.as.ts'), source);
  writeProfiler(directory, baseline);
  // asc otherwise respawns Node with source maps, and the launcher would
  // overwrite the compiler's RSS report on exit.
  const args = ['--enable-source-maps', '--require', path.join(directory, 'usage.cjs'), asc.script, 'canonical-native.as.ts',
    '--outFile', 'module.wasm', '--runtime', 'stub', '--noAssert', '--optimize'];
  appendAssemblyScriptOptimizationArgs(args);
  const transformIndex = args.indexOf('--transform');
  args[transformIndex + 1] = path.join(directory, 'profile.cjs');
  const started = process.hrtime.bigint();
  const compiled = spawnSync(asc.executable, args, { cwd: directory, encoding: 'utf8', timeout: 120000 });
  const compileMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stderr);
  const wasm = fs.readFileSync(path.join(directory, 'module.wasm'));
  const calls = [];
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), { env: {
    tap(value) { calls.push(value); return value * 3; },
    abort() { throw new Error('unexpected fixture abort'); }
  } });
  assert.equal(instance.exports.run(4), count * 12 + 2 * count * (count - 1));
  assert.deepEqual(calls, Array.from({ length: count }, (_, index) => index + 4));
  const retention = JSON.parse(fs.readFileSync(path.join(directory, 'retention.json')));
  const usage = JSON.parse(fs.readFileSync(path.join(directory, 'usage.json')));
  assert.equal(retention.compilerPid, usage.compilerPid, 'RSS belongs to the process running the transform');
  delete retention.compilerPid;
  delete usage.compilerPid;
  return {
    recipe: baseline ? 'per-name' : 'batched',
    compileMs,
    ...retention,
    ...usage,
    wasmBytes: wasm.length, wasmSha256: hash(wasm)
  };
}

function main() {
  const asc = resolveAsc(path.join(root, 'wasm'));
  assert.ok(asc, 'lockfile-pinned AssemblyScript is required');
  const directory = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-t01-'));
  try {
    const results = [];
    for (const [count, stride] of [[512, 1], [4096, 1], [4096, 8]]) {
      const source = sourceFor(count, stride);
      const pairs = [];
      for (let sample = 0; sample < 3; sample++) {
        const rows = [];
        // Alternate order to expose, rather than assume away, scheduling drift.
        for (const baseline of sample % 2 ? [false, true] : [true, false]) {
          const result = compile(path.join(directory, `${count}-${stride}-${sample}-${baseline}`), source, baseline, count, asc);
          rows.push(result);
          console.log(JSON.stringify({ count, stride, sample, ...result }));
        }
        assert.equal(rows[0].wasmSha256, rows[1].wasmSha256, 'exact optimized Wasm must match');
        assert.equal(rows[0].selected, rows[1].selected);
        pairs.push(rows);
      }
      results.push({ count, stride, fixtureSha256: hash(source), pairs });
    }
    console.log(JSON.stringify({
      proof: 'T01 retention cost', node: process.version,
      assemblyScript: JSON.parse(fs.readFileSync(path.join(asc.packageRoot, 'package.json'))).version,
      transformSha256: hash(fs.readFileSync(transformFile)),
      metric: 'fresh compiler process peak RSS from resourceUsage; wall includes startup and optimization',
      results
    }, null, 2));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

main();
