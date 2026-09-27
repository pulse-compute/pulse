#!/usr/bin/env node
'use strict';

// Structural evidence only. O-09 owns behavior; O-11 owns paired performance qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
// Reuse O-08's exact private inspector without changing its frozen source.
const Module = require('node:module');
const censusFile = require.resolve('./o08-wasm-census.cjs');
const censusOwner = new Module(censusFile, module);
censusOwner.filename = censusFile; censusOwner.paths = Module._nodeModulePaths(path.dirname(censusFile));
censusOwner._compile(fs.readFileSync(censusFile, 'utf8') + '\nmodule.exports.inspect = inspect;\n', censusFile);
const { inspect } = censusOwner.exports;
const baseline = require('./o08-evidence.json');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const preFactoringRevision = '5142725930ef8c481ad16b5b7ca2e8ebaab4ee6f';
const helperName = 'fastly-native-platform-capabilities.as/__pulse_application_settle_effect';
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function main() {
  const directory = path.join(root, 'wasm/.test-results/compiler-efficiency/o10', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  const files = [...Object.keys(baseline.sourceSha256),
    'wasm/test/runtime/compiler-efficiency/o10-driver-factoring.cjs', 'pnpm-lock.yaml'];
  const report = { version: 'pulse.o10.driver-factoring.v1', status: 'running', sourceRevision: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), node: process.version,
    sourceSha256: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    baselineRevision: baseline.sourceRevision, preFactoringRevision, profile: 'default', cells: [],
    limitations: ['Synthetic config.get controls reused unchanged from O-08.',
      'One production and one names-only build per cell; no time, RSS, memory or execution-performance claims.',
      'O-09 behavior is a separate required gate; O-11 owns full paired qualification.'] };
  const save = () => write(path.join(directory, 'report.json'), report); save();
  try {
    // The census file itself was new/uncommitted in its recorded O-07 revision.
    // Compare captured hashes at the merged O-09 base, not a nonexistent file in O-07.
    for (const file of files.filter(file => !file.includes('/o10-'))) {
      const expected = file === 'pnpm-lock.yaml' ? baseline.lockfileSha256 : baseline.sourceSha256[file];
      assert.ok(expected, `baseline identity missing: ${file}`);
      assert.equal(hash(execFileSync('git', ['show', `${preFactoringRevision}:${file}`], { cwd: root })), expected,
        `pre-factoring owner differs from O-08: ${file}`);
      if (!file.startsWith('packages/provider-fastly/')) assert.equal(report.sourceSha256[file], expected,
        `fixture or optimizer recipe changed: ${file}`);
    }
    const ids = ['sites-1-error-route', 'sites-8-error-route', 'sites-32-error-route', 'sites-32'];
    for (const id of ids) {
      const before = baseline.cells.find(row => row.cell.id === id); assert.ok(before, id);
      const out = path.join(directory, id); fs.mkdirSync(out);
      const builds = [false, true].map(named => {
        const run = spawnSync(process.execPath, [path.join(__dirname, 'o08-wasm-census.cjs'), '--compile',
          JSON.stringify({ cell: before.cell, directory: out, named })], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
        assert.equal(run.status, 0, run.error?.message || run.stderr); return JSON.parse(run.stdout.trim());
      });
      const [after, named] = builds;
      assert.deepEqual(after.fixtureSha256, before.fixtureSha256, 'unchanged O-08 fixture');
      assert.deepEqual(after.recipe, before.recipe, 'unchanged production optimizer recipe');
      assert.deepEqual(after.assemblyScript, before.assemblyScript); assert.deepEqual(after.jsonAs, before.jsonAs);
      assert.equal(after.sourceSha256, named.sourceSha256); assert.deepEqual(after.recipe, named.recipe);
      const wasm = fs.readFileSync(path.join(out, 'production.wasm'));
      const census = inspect(wasm, fs.readFileSync(path.join(out, 'named.wasm')), out);
      const graph = JSON.parse(fs.readFileSync(path.join(out, 'graph.json'), 'utf8'));
      const helpers = graph.functions.filter(f => f.name === helperName);
      if (before.cell.errorRoute && before.cell.effects > 1) {
        assert.equal(helpers.length, 1, 'one shared settlement body survives the actual optimizer');
        assert.equal(census.driver.calls.find(call => call.callee === helperName)?.sites, before.cell.effects,
          'every site retains a direct edge to the shared helper');
        assert.equal(census.driver.calls.some(call => /\/(?:__pulse_fastly_resolve_effect|__pulse_invocation_settle)$/.test(call.callee)), false,
          'resolution/settlement no longer repeats inside the driver');
        assert.ok(helpers[0].calls.some(call => /\/(?:__pulse_invocation_settle|pulse_set_effect_result)$/.test(call.callee)));
        assert.ok(census.driver.bytes + helpers[0].bytes < before.driver.bytes, 'combined driver/helper body is smaller');
      }
      if (!before.cell.errorRoute) {
        assert.equal(helpers.length, 0); assert.equal(after.sourceSha256, before.sourceSha256);
        assert.equal(after.wasmSha256, before.wasmSha256, 'non-error path stays byte-identical');
      }
      const gzipBytes = execFileSync('gzip', ['-n', '-9', '-c', path.join(out, 'production.wasm')]).length;
      report.cells.push({ id, effects: before.cell.effects, errorRoute: !!before.cell.errorRoute,
        fixtureSha256: after.fixtureSha256, sourceSha256: after.sourceSha256, wasmSha256: after.wasmSha256,
        namedWasmSha256: named.wasmSha256, namedCompanionSectionsByteExact: census.namedCompanionSectionsByteExact,
        before: { sourceBytes: before.sourceBytes, rawBytes: before.rawBytes, gzipBytes: before.gzipBytes, driverBytes: before.driver.bytes },
        after: { sourceBytes: after.sourceBytes, rawBytes: after.rawBytes, gzipBytes, driverBytes: census.driver.bytes,
          helperBytes: helpers.reduce((sum, helper) => sum + helper.bytes, 0) },
        driverCalls: census.driver.calls, helper: helpers[0] || null, fullGraphSha256: census.fullGraphSha256 });
      save(); console.log(`O-10 ${id}: driver ${before.driver.bytes} -> ${census.driver.bytes} B; shared helper ${helpers[0]?.bytes || 0} B`);
    }
    report.status = 'passed'; save();
    if (process.argv.includes('--record')) write(path.join(__dirname, 'o10-evidence.json'), report);
    console.log('O-10 structural proof passed: ' + path.relative(root, path.join(directory, 'report.json')));
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; save(); throw error; }
}
if (require.main === module) main();
