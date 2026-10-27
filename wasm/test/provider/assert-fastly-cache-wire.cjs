'use strict';
// Optional real-engine qualification. Failure is evidence, never an expected
// success: pinned Viceroy currently loses incomplete-body errors in readiness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const artifacts = argument('--artifacts-dir');
  assert(artifacts, 'Pass --artifacts-dir with the compiled cache evidence directory.');
  const launcher = cli.inspectFastlyComputeLauncher({
    viceroyBinary: argument('--viceroy'), required: true,
  });
  const report = { status: 'running', engine: launcher.viceroyInspection.version,
    engineSha256: hash(fs.readFileSync(launcher.viceroyInspection.binary)), artifacts: {}, cases: [] };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cache-wire-'));
  let server;
  const record = async (artifact, mode, request, input, verify) => {
    try {
      const response = await cli.requestFastlyCompute(server, input);
      const observed = { httpStatus: response.status, body: response.body.toString() };
      try { verify(response, observed.body); }
      catch (error) {
        report.cases.push({ artifact, mode, request, status: 'failed', ...observed, error: error.message });
        return;
      }
      report.cases.push({ artifact, mode, request, status: 'passed', ...observed });
    } catch (error) {
      report.cases.push({ artifact, mode, request, status: 'failed', error: error.message });
    }
  };
  const start = async name => {
    if (server) { await server.stop(); server = null; }
    const bytes = fs.readFileSync(path.join(artifacts, name + '.wasm'));
    report.artifacts[name] = { bytes: bytes.length, sha256: hash(bytes) };
    const wasmFile = path.join(temporary, 'main.wasm'), manifestFile = path.join(temporary, 'fastly.toml');
    fs.writeFileSync(wasmFile, bytes);
    fs.writeFileSync(manifestFile, cli.renderFastlyLocalConfig({ name: 'cache-proof', backends: {} }));
    server = await cli.startFastlyComputeServe({ launcher, packageRoot: temporary, wasmFile, manifestFile });
  };
  try {
    for (const name of ['readPlain', 'writePlain', 'sequencePlain', 'getText32', 'putText32']) {
      await start(name);
      for (let i = 1; i <= 3; i++) await record(name, 'ordinary', i, {}, (response, text) => {
        assert.equal(response.status, 200);
        const body = JSON.parse(text);
        if (name === 'readPlain') assert.deepEqual(body, { status: 'miss' });
        if (name === 'writePlain') assert.deepEqual(body, { status: 'stored' });
        if (name === 'sequencePlain') assert.deepEqual(body, { w: { status: 'stored' }, r: { status: 'found', text: 'é雪😀' } });
        if (name === 'getText32' || name === 'putText32') assert.deepEqual(Object.values(body),
          Array.from({ length: 32 }, () => ({ status: name === 'getText32' ? 'miss' : 'stored' })));
      });
    }
    for (const mode of ['commit', 'exact', 'empty', 'overflow', 'invalid', 'abandon', 'trap']) {
      await start('seededRead');
      const expected = ['commit', 'exact', 'empty'].includes(mode) ? 200 : 500;
      for (let i = 1; i <= 2; i++) await record('seededRead', mode, i,
        i === 1 ? { headers: { 'x-cache-seed': mode } } : {}, (response, text) => {
          assert.equal(response.status, expected);
          if (expected === 200) assert.deepEqual(JSON.parse(text), { status: 'found',
            text: mode === 'empty' ? '' : mode === 'exact' ? 'x'.repeat(64) : 'é雪😀' });
        });
    }
    report.status = report.cases.every(c => c.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
  } finally {
    if (server) await server.stop();
    fs.writeFileSync(path.join(artifacts, 'wire.json'), JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report));
  if (report.status !== 'passed') process.exitCode = 1;
  return report;
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
