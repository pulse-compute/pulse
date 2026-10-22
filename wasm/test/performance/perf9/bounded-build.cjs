'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { performance } = require('node:perf_hooks');
const [name, directory, variant, resultFile] = process.argv.slice(2);
assert(['default', 'bounded', 'rust'].includes(name) && directory && resultFile);
const contract = require('./contract.json');
const c = { ...contract, ...contract.variants.find(x => x.id === variant) };
assert(contract.variants.some(x => x.id === variant));
fs.mkdirSync(directory, { recursive: true });
const recipes = [];
const originalSpawn = child.spawnSync, originalExec = child.execFileSync;
child.spawnSync = function(executable, args, options) {
  if (!String(args?.[0]).replace(/\\/g, '/').endsWith('/assemblyscript/bin/asc.js')) return originalSpawn.call(this, executable, args, options);
  const rssFile = resultFile + `.asc-${recipes.length}.jsonl`;
  assert(!fs.existsSync(rssFile));
  const started = performance.now();
  const result = originalSpawn.call(this, executable, ['--require', path.join(__dirname, '../compiler-rss.cjs'), ...args],
    { ...options, env: { ...options.env, PS08_COMPILER_RSS_FILE: rssFile } });
  const observations = fs.readFileSync(rssFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  recipes.push({ executable, args, cwd: options.cwd, wallMs: performance.now() - started, observations,
    peakIndividualRssBytes: Math.max(...observations.map(x => x.peakBytes)) });
  return result;
};
const rustMetricsFile = resultFile + '.cargo.json';
child.execFileSync = function(executable, args, options) {
  if (path.basename(executable) !== 'cargo' || args?.[0] !== 'build') return originalExec.call(this, executable, args, options);
  return originalExec.call(this, 'python3', [path.join(__dirname, 'bounded-process-metrics.py'), rustMetricsFile, executable, ...args], options);
};
// Hooks are installed before production modules capture child-process functions.
const q = require('./qualify.cjs');
let artifact, generatedSource = null;
const rust = name === 'rust' ? q.rustIdentity() : null;
const started = performance.now();
if (name === 'rust') artifact = q.rustBuild(directory, c, rust);
else {
  fs.mkdirSync(path.join(directory, 'src')); fs.mkdirSync(path.join(directory, '.pulse'));
  fs.copyFileSync(path.join(__dirname, 'pulse.ts'), path.join(directory, 'src/index.ts'));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'perf9-01a-pulse', private: true, type: 'module' }, null, 2) + '\n');
  const fastly = { maxDurationMs: c.maxDurationMs, bodyForwarding: { requestMaxBytes: c.requestMaxBytes, responseMaxBytes: c.responseMaxBytes }, bindings: { backends: { [new URL(c.url).origin]: c.backend } } };
  const config = `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig(_=>({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:${JSON.stringify(fastly)}}}));\n`;
  fs.writeFileSync(path.join(directory, '.pulse/config.ts'), config);
  const project = require('../../../packages/cli/src/project-config.js').resolveProject({ cwd: directory, profile: 'proof' });
  const built = require('../../../packages/cli/src/project-execution.js').buildProject(project,
    name === 'bounded' ? { experimentalNativeBoundedSize: true } : { nativeShrink0: true });
  assert.equal(built.status, 'built');
  artifact = { ...q.artifact(path.join(built.outDir, 'bin/main.wasm')), configurationSha256: require('./measurement-protocol.cjs').hash(config) };
  const generated = path.join(built.outDir, 'src/main.as.ts');
  if (fs.existsSync(generated)) generatedSource = { file: generated, sha256: require('./measurement-protocol.cjs').hash(fs.readFileSync(generated)) };
}
const buildMs = performance.now() - started;
if (name !== 'rust') {
  assert(recipes.length > 0, 'ASC recipe was not captured');
  for (const recipe of recipes) {
    assert(recipe.peakIndividualRssBytes > 0);
    assert(!recipe.args.includes('--converge'));
    if (name === 'bounded') {
      assert.equal(recipe.args[recipe.args.indexOf('--optimizeLevel') + 1], '3');
      assert.equal(recipe.args[recipe.args.indexOf('--shrinkLevel') + 1], '2');
    } else assert.equal(recipe.args[recipe.args.indexOf('--shrinkLevel') + 1], '0');
    assert(!recipe.args.some(x => String(x).includes('schema-cache-arena-transform')));
  }
}
fs.writeFileSync(resultFile, JSON.stringify({ name, variant, artifact, generatedSource, buildMs, recipes, rust,
  compilerMemory: name === 'rust' ? JSON.parse(fs.readFileSync(rustMetricsFile, 'utf8')) : {
    peakIndividualRssBytes: Math.max(...recipes.map(x => x.peakIndividualRssBytes)),
    domain: 'Maximum individual AssemblyScript process RSS, including ASC source-map re-exec; not total build-tree RSS'
  }, workerPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  options: name === 'bounded' ? { experimentalNativeBoundedSize: true } : { nativeShrink0: true },
  noCacheArenaElision: true
}, null, 2) + '\n');
