#!/usr/bin/env node
'use strict';
// Evidence only. Generated-source checkpoints and rtrace never enter product builds.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const p02 = require('./p02-memory-trace.cjs');
const { replaceExact, diagnosticCompile, diagnosticHost, observer } = require('./mem01-schema-materialization.cjs');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const host = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { policy } = require('../../../../packages/provider-fastly/src/build/native-value-budget');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const counts = [0, 1, 16, 64];

function instrument(source) {
  source += '\n@external("o02", "checkpoint") declare function o02_checkpoint(stage: i32): void\n';
  source += 'export function o02_handles(): i32 { return __pulse_fastly_values.length }\n';
  source = replaceExact(source, '  __pulse_fastly_request_path = __pulse_fastly_path(__pulse_fastly_request_url)',
    '  __pulse_fastly_request_path = __pulse_fastly_path(__pulse_fastly_request_url)\n  o02_checkpoint(0)');
  source = replaceExact(source, '  let runStatus = pulse_start()',
    '  let runStatus = pulse_start()\n  o02_checkpoint(1)');
  source = replaceExact(source, '    runStatus = pulse_resume()',
    '    runStatus = pulse_resume()\n    o02_checkpoint(2)');
  source = replaceExact(source, '  const result = pulse_result_handle()',
    '  o02_checkpoint(3)\n  const result = pulse_result_handle()');
  const projection = source.match(/^    const projected = __pulse_fastly_schema_\w+\(valueHandle, !encode\)$/m);
  assert.ok(projection, 'one schema projection anchor');
  source = replaceExact(source, projection[0], '    o02_checkpoint(4)\n' + projection[0]);
  source = replaceExact(source, '    return __pulse_fastly_parse_json(normalized)',
    '    const o02_output = __pulse_fastly_parse_json(normalized)\n    o02_checkpoint(5)\n    return o02_output');
  return source;
}

function fixtureOptions(count) {
  const responses = p02.pageBodies(count);
  return { clockUnixSeconds: 1790294400, request: { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages',
      headers: [['x-start', count ? 'p1' : '']], body: '' }, secrets: p02.secrets, secretStore: 'app_secrets',
    fixtures: Object.fromEntries(Object.entries(responses).map(([url, body]) => ['GET ' + url,
      { status: 200, headers: [['content-type', 'application/json'], ['content-length', String(Buffer.byteLength(body))]], body }])) };
}

function runChild(dir, mode, count) {
  const options = fixtureOptions(count), wasm = fs.readFileSync(path.join(dir, mode + '.wasm'));
  const rssBeforeBytes = process.memoryUsage().rss;
  const snapshots = [];
  let probe, instance, sequence = 0;
  if (mode === 'traced') {
    probe = observer();
    const attach = probe.attach;
    probe.attach = value => { instance = value; attach(value); };
    probe.imports.o02 = { checkpoint(stage) {
      const metrics = probe.metrics();
      snapshots.push({ sequence: ++sequence, stage: ['request-ready', 'first-suspension', 'effect-resumed',
        'response-ready', 'schema-entry', 'schema-decoded'][stage], handles: instance.exports.o02_handles(),
        rssBytes: process.memoryUsage().rss, ...metrics });
    } };
    options.mem01 = probe;
  }
  const execute = mode === 'traced' ? diagnosticHost() : host.executeFastlyNativePlatformCapabilities;
  const result = execute(wasm, options);
  assert.equal(result.response.body, `${count}:${count - 1}`);
  assert.equal(result.response.status, 200);
  const outboundRequests = result.outboundRequests.length;
  assert.equal(outboundRequests, count);
  const summary = { mode, pages: count, pageBytes: p02.PAGE_BYTES, response: result.response.body,
    responseSha256: sha(result.response.body), traceSha256: sha(JSON.stringify(result.trace)),
    traceEntries: result.trace.length, outboundRequests,
    chargeBytes: Number(result.instance.exports.pulse_fastly_memory_bytes()),
    chargeValues: Number(result.instance.exports.pulse_fastly_memory_values()),
    rssBeforeBytes, rssAfterBytes: process.memoryUsage().rss,
    finalCapacityBytes: result.instance.exports.memory.buffer.byteLength };
  if (probe) {
    const terminal = probe.metrics();
    const collected = probe.collect();
    const fixed = probe.collect();
    assert.equal(fixed.outstandingBytes, collected.outstandingBytes, 'terminal collection reaches fixed point');
    summary.allocation = { terminal, postCollect: collected,
      temporaryUncollectedBytes: terminal.outstandingBytes - collected.outstandingBytes,
      checkpoints: snapshots,
      maximumCheckpoint: snapshots.reduce((best, row) => !best || row.outstandingBytes > best.outstandingBytes ? row : best, null) };
  }
  return summary;
}

function main() {
  const dir = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-o02-'));
  try {
    const project = path.join(dir, 'project'); fs.mkdirSync(project); p02.prepareFixture(project);
    p02.compileWorker('node', project, dir);
    const plan = read(path.join(dir, 'plan.json'));
    const { resolveProject } = require('../../../packages/cli/src/project-config');
    const bindings = resolveProject({ cwd: project, profile: 'fastly' }).providerConfig.bindings;
    const compiled = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: project, bindings, canonicalBuild: true });
    assert.equal(compiled.manifest.schemaCodecs.active, true);
    assert.equal(compiled.guestUnits.length, 0, 'rtrace requires incremental, non-linked runtime');
    assert.deepEqual(diagnosticCompile(compiled.source, 'control', dir,
      { maximumMemoryPages: policy.maximumMemoryPages }), compiled.wasm, 'uninstrumented compiler recipe reproduces production Wasm');
    fs.writeFileSync(path.join(dir, 'production.wasm'), compiled.wasm);
    const traced = diagnosticCompile(instrument(compiled.source), 'traced', dir,
      { maximumMemoryPages: policy.maximumMemoryPages });
    fs.writeFileSync(path.join(dir, 'traced.wasm'), traced);
    const cases = [];
    for (const count of counts) {
      const variants = {};
      for (const mode of ['production', 'traced']) {
        const result = spawnSync(process.execPath, [__filename, '--case', dir, mode, String(count)],
          { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
        assert.equal(result.status, 0, `${mode}/${count}: ${result.error?.message || result.stderr}`);
        variants[mode] = JSON.parse(result.stdout);
      }
      const a = variants.production, b = variants.traced;
      for (const key of ['response', 'responseSha256', 'traceSha256', 'traceEntries', 'outboundRequests', 'chargeBytes', 'chargeValues'])
        assert.deepEqual(b[key], a[key], `${count} pages: ${key} semantic parity`);
      cases.push({ pages: count, fixtureBytes: count * p02.PAGE_BYTES,
        fixtureSha256: sha(Object.values(p02.pageBodies(count)).join('')), ...variants });
    }
    const report = { schemaVersion: 'pulse.compiler-efficiency-o02.v1', status: 'passed',
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      fixtureSourceSha256: sha(['src/index.ts', 'src/schemas.ts', 'src/types.ts', '.pulse/config.ts']
        .map(file => fs.readFileSync(path.join(root, 'wasm/test/fixtures/projects/compiler-efficiency-memory', file))).join('')),
      harnessSha256: sha(fs.readFileSync(__filename)), lockfileSha256: sha(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
      toolchain: { node: process.version, assemblyScript: compiled.manifest.assemblyScript.version,
        allocator: 'incremental', maximumMemoryPages: policy.maximumMemoryPages },
      artifacts: { generatedSourceSha256: sha(compiled.source), productionWasmSha256: sha(compiled.wasm),
        tracedWasmSha256: sha(traced), productionWasmBytes: compiled.wasm.length, tracedWasmBytes: traced.length,
        uninstrumentedControlByteIdentical: true }, cases,
      limitations: [
        'Fastly injected ABI host only; this measures the AssemblyScript guest, not Node guest, Viceroy or deployed Compute.',
        'rtrace and checkpoint imports perturb optimization, garbage collection, and resident memory. Production and traced RSS are separate fresh processes, not a speedup comparison.',
        'Cumulative allocation counts allocator block bytes including overhead; outstanding includes not-yet-collected garbage. Terminal forced collection is a diagnostic retained-set estimate, not a reachability proof.',
        'Capacity is reserved linear memory, not live allocation. Checkpoint maximum can miss a peak between callbacks; rtrace peak is for the full invocation.',
        'RSS is process-wide at named checkpoints and includes V8, host fixtures, and Wasm; it is not guest live memory.'
      ] };
    const output = path.join(root, 'wasm/.test-results/compiler-efficiency/o02/measurements.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); write(output, report);
    console.log(JSON.stringify({ status: report.status, report: path.relative(root, output), cases: cases.length }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (require.main === module && process.argv[2] === '--case') {
  try { console.log(JSON.stringify(runChild(process.argv[3], process.argv[4], Number(process.argv[5])))); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
} else if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
module.exports = { instrument, runChild, main };
