'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture } = require('../runtime/context-native-fixture.cjs');
const { expectations } = require('./context-installed-oracle.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file));
async function qualify({ consumer, temporary, root, run, env }) {
  const app = path.join(consumer, 'application');
  const proof = path.join(temporary, 'native-proof'); fs.mkdirSync(proof);
  const manifest = json(path.join(consumer, 'context-data/context-manifest.json'));
  const source = fs.readFileSync(path.join(consumer, 'context-corpus.ts'), 'utf8');
  const corpus = JSON.parse(source.slice(source.indexOf('export const contextCorpus = freeze(') + 'export const contextCorpus = freeze('.length, source.lastIndexOf(' as const);')));
  assert.equal(corpus.corpusHash, manifest.source.corpusHash);
  const independent = fixture(corpus);
  const inventory = [];
  function verifyOutputs() {
    for (const output of manifest.outputs) {
      assert(!path.isAbsolute(output.path) && !output.path.split('/').includes('..'));
      const file = path.join(consumer, output.path), bytes = fs.readFileSync(file);
      assert.equal(bytes.length, output.byteLength, output.path);
      assert.equal(hash(bytes), output.sha256, output.path);
    }
  }
  verifyOutputs();
  for (const output of manifest.outputs) inventory.push({ ...output });
  for (const file of independent.files) assert.deepEqual(fs.readFileSync(path.join(consumer, 'context-data', file.path.slice(1))), file.bytes, 'independent binary reconstruction ' + file.path);
  const rejected = [];
  for (const file of independent.files) {
    const target = path.join(consumer, 'context-data', file.path.slice(1)), original = fs.readFileSync(target);
    for (const fault of ['missing', 'truncated', 'corrupt', 'mixed-identity']) {
      try {
        if (fault === 'missing') fs.unlinkSync(target);
        else if (fault === 'truncated') fs.writeFileSync(target, original.subarray(0, original.length - 1));
        else { const bytes = Buffer.from(original); bytes[fault === 'mixed-identity' ? 32 : bytes.length - 1] ^= 1; fs.writeFileSync(target, bytes); }
        assert.throws(verifyOutputs); rejected.push({ file: file.path, fault, boundary: 'packed-context-manifest' });
      } finally { fs.writeFileSync(target, original); }
    }
  }
  const mcp = path.join(consumer, 'node_modules/@pulse-compute/mcp');
  const mcpFiles = ['src/pulse.js', 'src/pulse.d.ts', 'pulse.package.json', 'pulsewasm.manifest.cjs', 'pulsewasm.compiler.cjs'];
  const lowerer = mcpFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(mcp, file))) }));
  const configFile = path.join(app, '.pulse/config.ts'), config = fs.readFileSync(configFile, 'utf8');
  const line = config.split('\n').find(line => line.trimStart().startsWith('manifest: '));
  assert(line, 'immutable manifest literal');
  const literal = line.trim().slice('manifest: '.length).replace(/,$/, '');
  const resources = JSON.parse(JSON.parse(literal));
  for (const file of resources.files) assert.deepEqual(Buffer.from(file.data, 'base64'), independent.files.find(f => f.path === file.path).bytes);
  const expected = path.join(proof, 'expected.json');
  const cases = expectations(consumer, proof, corpus, manifest);
  fs.writeFileSync(expected, JSON.stringify(cases));
  const worker = path.join(proof, 'worker.cjs'); fs.copyFileSync(path.join(__dirname, 'context-installed-worker.cjs'), worker);
  const settingsFile = path.join(proof, 'settings.json');
  const settings = { consumer, checkoutProbe: path.join(root, 'package.json'), expected, result: path.join(proof, 'result.json'), buildDir: path.join(app, 'dist-node-native'), removedSources: [path.join(app, 'src/index.ts'), configFile, path.join(consumer, 'context-corpus.ts'), path.join(consumer, 'node_modules/@pulse-compute/cli/examples/12-pulse-context-mcp/context-corpus.ts')] };
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
  const scratch = path.join(consumer, '.native-temp'); fs.mkdirSync(scratch);
  const trace = path.join(proof, 'trace.cjs');
  fs.writeFileSync(trace, `const fs=require('node:fs');for(const key of ['readFileSync','realpathSync','statSync','lstatSync','readdirSync','accessSync']){const original=fs[key];const wrapped=function(...args){try{return original.apply(this,args)}catch(e){if(e.code==='ERR_ACCESS_DENIED')process.stderr.write('denied filesystem read: '+e.resource+'\\n');throw e}};Object.assign(wrapped,original);fs[key]=wrapped;}`);
  // TypeScript probes an uppercased copy of its own path to detect filesystem
  // case sensitivity. Permit only that consumer-local probe, not the checkout.
  const buildEnv = { ...env, TMPDIR: scratch, NODE_COMPILE_CACHE: '', NODE_OPTIONS: `--permission --allow-fs-read=${consumer} --allow-fs-read=${consumer.toUpperCase()} --allow-fs-read=${proof} --allow-fs-write=${consumer} --allow-child-process --allow-worker --require=${trace}` };
  await run(process.execPath, [worker, 'guard', settingsFile], { environment: buildEnv });
  const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
  await run(process.execPath, [path.join(consumer, 'node_modules/typescript/bin/tsc'), '--project', path.join(app, 'tsconfig.json')], { environment: buildEnv });
  // The production config loader independently rejects invalid embedded resources.
  // Keep the declared manifest identity authoritative; changing it would describe
  // a different application, not corruption of this exact packed application.
  const { spawnSync } = require('node:child_process');
  for (const name of ['/vector.bin', '/text.bin', '/metadata.bin']) for (const fault of ['missing', 'truncated', 'corrupt', 'mixed-identity']) {
    const changed = structuredClone(resources), at = changed.files.findIndex(f => f.path === name);
    if (fault === 'missing') changed.files.splice(at, 1);
    else { let bytes = Buffer.from(changed.files[at].data, 'base64'); if (fault === 'truncated') bytes = bytes.subarray(0, bytes.length - 1); else bytes[fault === 'mixed-identity' ? 32 : bytes.length - 1] ^= 1; changed.files[at].data = bytes.toString('base64'); }
    try {
      fs.writeFileSync(configFile, config.replace(literal, JSON.stringify(JSON.stringify(changed))));
      const result = spawnSync(process.execPath, [cli, 'inspect', '--profile', 'node-native', '--json'], { cwd: app, env: buildEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /PULSE_BINARY_RESOURCE_INVALID/);
      rejected.push({ file: name, fault, boundary: 'installed-config-admission', exitCode: result.status });
    } finally { fs.writeFileSync(configFile, config); }
  }
  await run(process.execPath, [cli, 'build', '--profile', 'node-native', '--json'], { cwd: app, environment: buildEnv, timeout: 180000 });
  const built = json(path.join(settings.buildDir, 'pulse-build.json'));
  assert.equal(built.status, 'built'); assert.equal(built.configuredTarget, 'native');
  assert.equal(built.automaticFallback, false);
  // Remove the extracted authored inputs. The runtime permission grants below
  // also exclude the older app and the copy still present inside the CLI package.
  for (const file of ['src', '.pulse', 'tsconfig.json']) fs.rmSync(path.join(app, file), { recursive: true, force: true });
  const modules = path.join(consumer, 'node_modules');
  const allowed = [proof, settings.buildDir, path.join(consumer, 'package.json')];
  for (const entry of fs.readdirSync(modules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) for (const name of fs.readdirSync(path.join(modules, entry))) {
      if (`${entry}/${name}` !== '@pulse-compute/cli') allowed.push(path.join(modules, entry, name));
    } else allowed.push(path.join(modules, entry));
  }
  const runtimeEnv = { ...env, NODE_COMPILE_CACHE: '', NODE_OPTIONS: ['--permission', ...allowed.map(p => `--allow-fs-read=${p}`), `--allow-fs-write=${settings.buildDir}`, `--allow-fs-write=${proof}`].join(' ') };
  await run(process.execPath, [worker, 'runtime', settingsFile], { environment: runtimeEnv, timeout: 120000 });
  // Installed packages remain byte-identical; only disposable extracted sources
  // were removed. The independent legacy host journey still runs in the parent.
  return { status: 'passed', manifestSha256: hash(fs.readFileSync(path.join(consumer, 'context-data/context-manifest.json'))), corpusHash: corpus.corpusHash, rows: corpus.records.length, inventory, lowerer, independentFiles: independent.files.map(f => ({ path: f.path, sha256: hash(f.bytes) })), expectedSha256: hash(fs.readFileSync(expected)), expectedCases: cases.length, rejected, runtime: json(settings.result), installedCliUsed: true, repositoryReadsDenied: true, sourceInputsRemoved: true };
}
module.exports = { qualify };
