'use strict';

// Opt-in review evidence, not a timing benchmark or a release gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const identity = root => ({
  revision: git(root, 'rev-parse', 'HEAD'),
  tree: git(root, 'rev-parse', 'HEAD^{tree}'),
  workingTree: git(root, 'status', '--porcelain', '--untracked-files=all'),
  lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml')))
});
const sizes = bytes => ({ bytes: Buffer.byteLength(bytes), gzipBytes: gzipSync(bytes).length, sha256: hash(bytes) });
const capacities = [1, 4, 16, 32];

function wasmSizes(input) {
  const bytes = Buffer.from(input), sections = {};
  assert.equal(bytes.subarray(0, 8).toString('hex'), '0061736d01000000');
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset++];
    let length = 0, shift = 0, byte;
    do {
      assert(offset < bytes.length && shift <= 28, 'Invalid section length');
      byte = bytes[offset++]; length += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    assert(offset + length <= bytes.length);
    if (id === 10 || id === 11) sections[id === 10 ? 'codeSha256' : 'dataSha256'] = hash(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return { ...sizes(bytes), ...sections };
}

function fixture(kind, count) {
  if (kind === 'no-effects') return 'return ctx.json({ ok: true });';
  if (kind === 'single-fetch') {
    return 'const result = await ctx.fetch("https://origin.example/0").text(); return ctx.text(result);';
  }
  const prefix = 'const input = await ctx.req.json();';
  if (kind === 'dynamic') return `${prefix}
    const effects = ctx.effects({ max: ${count} });
    for (const endpoint of input.endpoints) { effects.add(ctx.fetch(endpoint).text()); }
    const results = await ctx.parallel(effects);
    return ctx.json(results);`;
  const members = Array.from({ length: count }, (_, i) => `r${i}: ctx.fetch(input.endpoints[${i}]).text()`);
  const results = Array.from({ length: count }, (_, i) => `results.r${i}`);
  return `${prefix} const results = await ctx.parallel({ ${members.join(', ')} });
    return ctx.json([${results.join(', ')}]);`;
}

async function snapshot(root, collections) {
  const before = identity(root);
  assert.equal(before.workingTree, '', 'Measure a clean checkout; keep the measurement script outside it.');
  const local = file => require(path.join(root, file));
  const { compileCanonicalSource } = local('wasm/packages/compiler/src/canonical-api-compiler.js');
  const { buildCanonicalNativePlan } = local('wasm/packages/compiler/src/canonical-native-plan.js');
  const { compileCanonicalNativePlan } = local('wasm/packages/compiler/src/canonical-native-compiler.js');
  const { compileFastlyNativePlatformCapabilitiesPlan } = local('packages/provider-fastly/src/build/native-platform-capabilities.js');
  const { executeCanonicalNativeModule } = local('wasm/packages/host-runtime/src/runtime/canonical-native-host.js');
  const { executeFastlyNativePlatformCapabilities } = local('packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
  const { bundleFastlyJavascriptApplication } = local('packages/provider-fastly/src/javascript/source-package.js');
  const cells = [['no-effects', 0], ['single-fetch', 1], ...capacities.map(n => ['static', n]),
    ...(collections ? capacities.map(n => ['dynamic', n]) : [])];
  const temporary = path.join(root, 'wasm/.test-results/effect-collection-size');
  assert(!fs.existsSync(temporary), 'Refuse to overwrite an existing measurement directory.');
  fs.mkdirSync(temporary, { recursive: true });
  const rows = [];
  try {
    for (const [kind, count] of cells) {
      const body = fixture(kind, count);
      const source = `export default async function handler(ctx) { ${body} }`;
      const plan = buildCanonicalNativePlan(compileCanonicalSource(source, {
        fileName: 'size-probe.ts', strict: false
      }));
      const core = compileCanonicalNativePlan(plan, { cwd: root });
      const fastly = compileFastlyNativePlatformCapabilitiesPlan(plan, {
        cwd: root, requirePlatformCapability: false, canonicalBuild: true,
        effectBackends: Object.fromEntries(plan.effects.map(effect => [effect.id, 'origin']))
      });
      const imports = WebAssembly.Module.imports(new WebAssembly.Module(core.wasm));
      const collectionImport = imports.some(entry => entry.name === 'effect_collection_count');
      assert.equal(collectionImport, kind === 'dynamic');
      const endpoints = Array.from({ length: count }, (_, i) => `https://origin.example/${i}`);
      const request = { method: 'POST', path: '/', body: JSON.stringify({ endpoints }) };
      const expected = kind === 'no-effects' ? JSON.stringify({ ok: true })
        : kind === 'single-fetch' ? 'value-0' : JSON.stringify(endpoints.map((_, i) => `value-${i}`));
      const result = await executeCanonicalNativeModule(core, { request, providerAdapter: {
        id: 'size-probe', dispatchEffect(effect) {
          return { status: 200, headers: [], kind: 'text', body: `value-${new URL(effect.url || effect.parts.url).pathname.slice(1)}` };
        }
      } });
      assert.equal(result.response.status, 200);
      assert.equal(result.response.body, expected);
      const fastlyResult = executeFastlyNativePlatformCapabilities(fastly, { request, fixtures: {
        origin: Object.fromEntries(endpoints.map((url, i) => [new URL(url).pathname, { body: `value-${i}` }]))
      } });
      assert.equal(fastlyResult.response.status, 200);
      assert.equal(fastlyResult.response.body, expected);
      fs.writeFileSync(path.join(temporary, 'index.ts'),
        `import { Pulse } from '@pulse-compute/pulse';\nconst app = new Pulse({auto:true});\n` +
        `app.post('/', async ctx => { ${body} });\nexport default app;\n`);
      const javascript = bundleFastlyJavascriptApplication({ workspace: { entry: 'index.ts' } }, temporary);
      rows.push({ kind, capacity: count, sourceSha256: hash(source),
        core: { ...wasmSizes(core.wasm), collectionImport }, fastlyNative: wasmSizes(fastly.wasm),
        fastlyJavascriptSource: sizes(javascript.source) });
      process.stderr.write(`measured ${collections ? 'candidate' : 'baseline'} ${kind}/${count}\n`);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  assert.deepEqual(identity(root), before, 'Measurement changed the checkout.');
  return { identity: before, rows };
}

async function main() {
  const [mode, baselineRoot, candidateRoot] = process.argv.slice(2);
  if (mode === '--snapshot') {
    console.log(JSON.stringify(await snapshot(path.resolve(baselineRoot), candidateRoot === 'collections')));
    return;
  }
  assert.equal(mode, '--compare', 'Usage: node measure-effect-collection-size.cjs --compare BASELINE_ROOT CANDIDATE_ROOT > results.json');
  assert(baselineRoot && candidateRoot);
  const run = (root, mode) => JSON.parse(execFileSync(process.execPath,
    [__filename, '--snapshot', path.resolve(root), mode], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000, maxBuffer: 4 * 1024 * 1024
    }));
  // Separate processes prevent require-cache contamination between checkouts.
  const baseline = run(baselineRoot, 'legacy');
  const candidate = run(candidateRoot, 'collections');
  assert.equal(baseline.identity.lockfileSha256, candidate.identity.lockfileSha256);
  const unchanged = baseline.rows.map(before => {
    const after = candidate.rows.find(row => row.kind === before.kind && row.capacity === before.capacity);
    assert.equal(before.sourceSha256, after.sourceSha256);
    return { kind: before.kind, capacity: before.capacity,
      ...Object.fromEntries(['core', 'fastlyNative', 'fastlyJavascriptSource'].map(target => [target, {
        deltaBytes: after[target].bytes - before[target].bytes,
        deltaGzipBytes: after[target].gzipBytes - before[target].gzipBytes,
        identical: after[target].sha256 === before[target].sha256,
        ...(target === 'fastlyJavascriptSource' ? {} : {
          identicalCode: after[target].codeSha256 === before[target].codeSha256,
          identicalData: after[target].dataSha256 === before[target].dataSha256
        })
      }])) };
  });
  console.log(JSON.stringify({ schemaVersion: 'pulse.effect-collection-size.v1', status: 'passed',
    node: process.version, platform: process.platform, arch: process.arch,
    measurementSha256: hash(fs.readFileSync(__filename)), baseline, candidate, unchanged,
    limits: [
      'Small synthetic handlers; no general zero-overhead guarantee.',
      'Fastly Native uses injected ABI acceptance, not a deployed service.',
      'JavaScript measures the existing unminified application source bundler, not final js-compute Wasm.',
      'gzip is a size diagnostic, not the Fastly deployed artifact quota.',
      'No latency, GC, RSS, retained payload or package installation size measurement.'
    ] }, null, 2));
}
main().catch(error => { console.error(error.stack); if (error.diagnostics) console.error(error.diagnostics); if (error.detail) console.error(error.detail); process.exitCode = 1; });
