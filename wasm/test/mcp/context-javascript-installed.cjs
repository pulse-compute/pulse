'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { expectations } = require('./context-installed-oracle.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file));

async function qualify({ consumer, temporary, root, run, env, verifyCopy }) {
  const app = path.join(temporary, 'javascript-consumer');
  const proof = path.join(temporary, 'javascript-proof');
  fs.mkdirSync(proof);
  fs.cpSync(path.join(consumer, 'application'), app, { recursive: true });
  fs.cpSync(path.join(consumer, 'node_modules'), path.join(app, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  require('node:child_process').execFileSync('git', ['init', '--quiet', app], { env });
  const installed = verifyCopy(app);
  const cli = path.join(app, 'node_modules/@pulse-compute/cli/bin/pulse.js');
  const pulse = async args => JSON.parse((await run(process.execPath,
    [cli, ...args, '--profile', 'node-javascript', '--json'], { cwd: app })).stdout);
  const doctor = await pulse(['doctor']);
  assert.equal(doctor.status, 'warning');
  assert.deepEqual(doctor.checks.filter(c => c.status === 'warning').map(c => c.id), ['tests']);
  assert.equal(doctor.summary.failed, 0);
  const targetSupport = doctor.checks.find(c => c.id === 'target-support');
  assert.equal(targetSupport.status, 'passed');
  const support = targetSupport.detail.project;
  assert.equal(support.status, 'eligible');
  for (const id of ['effect-execution', 'logging', 'response-transport', 'request', 'request.deadline']) {
    assert.equal(support.providerRequirements.find(r => r.id === id)?.status, 'eligible', id);
  }
  for (const id of ['dev', 'test']) assert.equal(support.commands.find(c => c.id === id)?.status, 'eligible', id);
  let response;
  await run(process.execPath, [cli, 'dev', '--profile', 'node-javascript', '--port', '0', '--no-watch', '--once', '--json'], {
    cwd: app, timeout: 60000,
    onOutput(stdout) {
      for (const line of stdout.split('\n')) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (response || event.event !== 'ready') continue;
        response = fetch(new URL('/mcp', event.url), { method: 'POST',
          headers: { origin: 'null' }, body: '{}', signal: AbortSignal.timeout(5000) })
          .then(async r => ({ status: r.status, body: await r.text() }))
          .catch(error => ({ error: error.message }));
      }
    }
  });
  assert(response, 'installed dev must listen');
  assert.equal((await response).status, 403, 'MCP admission remains enforced through dev');
  const built = await pulse(['build']);
  assert.equal(built.status, 'built');
  assert.equal(built.configuredTarget, 'javascript');
  const manifest = json(path.join(consumer, 'context-data/context-manifest.json'));
  const source = fs.readFileSync(path.join(consumer, 'context-corpus.ts'), 'utf8');
  const corpus = JSON.parse(source.slice(source.indexOf('export const contextCorpus = freeze(') + 'export const contextCorpus = freeze('.length, source.lastIndexOf(' as const);')));
  const cases = expectations(consumer, proof, corpus, manifest);
  const expected = path.join(proof, 'expected.json');
  fs.writeFileSync(expected, JSON.stringify(cases));
  const worker = path.join(proof, 'worker.cjs');
  fs.copyFileSync(path.join(__dirname, 'context-javascript-worker.cjs'), worker);
  const settings = { consumer: app, buildDir: path.join(app, 'dist-node-javascript'), expected, result: path.join(proof, 'result.json') };
  const settingsFile = path.join(proof, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
  // The built source package must own its closure, independently of authored inputs.
  for (const file of ['src', '.pulse', 'tsconfig.json']) fs.rmSync(path.join(app, file), { recursive: true });
  await run(process.execPath, [worker, settingsFile], { cwd: app, timeout: 120000 });
  assert.deepEqual(verifyCopy(app), installed);
  return { status: 'passed', installed, doctor: doctor.summary, providerRequirements: support.providerRequirements,
    devAdmissionStatus: 403, sourceInputsRemoved: true, expectedCases: cases.length,
    expectedSha256: hash(fs.readFileSync(expected)), runtime: json(settings.result),
    fixtureSha256: hash(fs.readFileSync(__filename)), workerSha256: hash(fs.readFileSync(worker)) };
}
module.exports = { qualify };
