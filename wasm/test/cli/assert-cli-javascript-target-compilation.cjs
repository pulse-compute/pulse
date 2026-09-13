#!/usr/bin/env node
'use strict';

const { releaseVersion } = require('../../../release/pulse-release-manifest.json');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { repoRoot, run, parseJson, parseError } = require('./helpers.cjs');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalSource, loadCanonicalModule, writeCanonicalBuild } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { traceForCanonicalSourceOutput } = require('../../packages/compiler/src/spine/canonical-source.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-js-target-'));
function write(file, source) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}
function compile(target, extra = {}) {
  return compileCanonicalProject(path.join(root, 'src/index.ts'), {
    rootDir: root, workspaceRoot: repoRoot, target, strict: false,
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'fixture' }, target: target || 'native', host: 'node', strict: false,
      projectHash: '1'.repeat(64), configPlanHash: '2'.repeat(64), bindings: { config: [], secret: [] }, fragments: {}
    },
    requireAsync: true, ...extra
  });
}
function assertNativeRejected() {
  for (const target of [undefined, 'native']) {
    assert.throws(() => compile(target), (error) => error.diagnostics.some((d) => d.code === 'PULSE_NATIVE_IMPORT_UNSUPPORTED'));
  }
  // The old graph-only inspection switch must not select JavaScript semantics.
  assert.throws(() => compile('native', { nativeEligibilityMode: 'record' }));
  const error = parseError(run(['inspect', '--profile', 'native', '--json'], root), 3);
  assert.ok(error.error.diagnostics.some((d) => d.code === 'PULSE_NATIVE_IMPORT_UNSUPPORTED'));
}

async function main() {
  try {
    const sourceInspection = compileCanonicalSource(`import { label } from '@fixture/ordinary';
      export default async function handler(ctx) { const value = await label('ready'); return ctx.json({ value }); }`, { target: 'javascript' });
    assert.ok(traceForCanonicalSourceOutput(sourceInspection), 'JavaScript inspection retains the compiler phase trace');
    assert.equal(sourceInspection.generatedSource, undefined);
    write('package.json', JSON.stringify({ name: 'javascript-target-regression', version: '1.0.0', private: true,
      dependencies: { '@fixture/ordinary': '1.0.0', '@pulse-compute/pulse': releaseVersion, '@pulse-compute/provider-node': releaseVersion }
    }));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'runtime', 'provider-node']) {
      fs.symlinkSync(path.join(repoRoot, 'packages', name), path.join(root, 'node_modules/@pulse-compute', name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    write('node_modules/@fixture/ordinary/package.json', JSON.stringify({ name: '@fixture/ordinary', version: '1.0.0', main: 'index.cjs' }));
    write('node_modules/@fixture/ordinary/index.cjs', `exports.label = async (value) => {
      await Promise.resolve();
      return [value, 'javascript'].map((part) => part.toUpperCase()).join(':');
    };\n`);
    write('.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse';
      export default defineConfig((scope) => ({
        pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'javascript', strict: false },
        javascript: { host: 'node', target: 'javascript', outDir: 'dist' },
        native: { host: 'node', target: 'native', outDir: 'native-dist' }
      }));\n`);
    write('tests/pulse.harness.ts', `export default [{ name: 'ordinary dependency',
      request: { method: 'GET', path: '/health' }, expect: { status: 200, json: { value: 'READY:JAVASCRIPT' } }
    }];\n`);

    const sources = [
      // The historical application's terminal adapter shape, including an
      // ordinary Promise boundary that Native cannot represent.
      `import { Pulse } from '@pulse-compute/pulse';
       import { label } from '@fixture/ordinary';
       const app = new Pulse({ auto: true });
       async function health(ctx) { const value = await label('ready'); return ctx.json({ value }); }
       app.get('/health', health); export default app;`,
      // A linked Router plus a project-relative value/helper import.
      `import { Pulse } from '@pulse-compute/pulse';
       import routes from './routes';
       const app = new Pulse({ auto: true }); app.mount('/', routes); export default app;`,
      // A plain handler reached through a barrel follows the same target.
      `export { default } from './handler';`
    ];
    write('src/helpers.ts', `import { label } from '@fixture/ordinary';
      export const ready = 'ready';
      export async function value(input) { return await label(input); }\n`);
    write('src/routes.ts', `import { Router } from '@pulse-compute/runtime';
      import { ready, value as format } from './helpers';
      const routes = new Router();
      async function health(ctx) { const value = await format(ready); return ctx.json({ value }); }
      routes.get('/health', health); export default routes;\n`);
    write('src/handler.ts', `import { ready, value as format } from './helpers';
      export default async function handler(ctx) { const value = await format(ready); return ctx.json({ value }); }\n`);

    for (const [index, source] of sources.entries()) {
      write('src/index.ts', source);
      const compiled = compile('javascript');
      assert.equal(compiled.target, 'javascript');
      assert.equal(compiled.metadata.promiseSemantics, true);
      assert.equal(compiled.nativeEligibility.eligible, false);
      assert.equal(compiled.generatedSource, undefined, 'inspection must not expose an executable generator with erased JavaScript semantics');
      assert.throws(() => buildCanonicalNativePlan(compiled));
      assert.throws(() => loadCanonicalModule(compiled));
      assert.throws(() => writeCanonicalBuild(compiled, path.join(root, 'invalid-generator')));
      assert.ok(!fs.existsSync(path.join(root, 'invalid-generator')));
      assertNativeRejected();
      const compileOnly = parseError(run(['compile', '--json'], root), 3);
      assert.equal(compileOnly.error.code, 'PULSE_CANONICAL_NATIVE_PLAN_FAILED');
      assert.ok(!fs.existsSync(path.join(root, 'dist/pulse-compile.json')));
      const doctor = parseJson(run(['doctor', '--json'], root));
      assert.equal(doctor.summary.failed, 0);
      assert.equal(doctor.checks.find((c) => c.id === 'canonical-compile').status, 'passed');
      assert.equal(doctor.checks.find((c) => c.id === 'canonical-native-plan').status, 'warning');
      const inspection = parseJson(run(['inspect', '--json'], root));
      assert.equal(inspection.provider.selectedTarget, 'javascript');
      assert.equal(inspection.compiler.native.status, 'unavailable-for-project');
      assert.equal(inspection.provider.realization.automaticFallback, false);
      const tested = parseJson(run(['test', '--json'], root));
      assert.deepEqual(tested.summary, { total: 1, passed: 1, failed: 0 });
      const out = `dist-${index}`;
      const built = parseJson(run(['build', '--out', out, '--json'], root));
      assert.equal(built.buildMode, 'javascript-source-package');
      assert.equal(built.manifest.providerTarget.nativeWasm, false);
      assert.equal(built.manifest.automaticFallback, false);
      const firstHash = built.manifest.application.planHash;
      assert.equal(parseJson(run(['build', '--out', out, '--json'], root)).manifest.application.planHash, firstHash);
      assert.ok(!fs.existsSync(path.join(root, out, 'canonical-handler.cjs')));
      const request = createRequire(path.join(root, 'package.json'));
      const application = request(built.files.entry);
      const { executeNodeJavascriptTestCase } = request('@pulse-compute/provider-node/javascript/test-runtime');
      const executed = await executeNodeJavascriptTestCase(application, {
        name: 'packaged dependency', request: { method: 'GET', path: '/health', headers: [] }
      }, { provider: 'node', strict: false, networkFetch: false });
      assert.equal(executed.response.status, 200);
      assert.deepEqual(JSON.parse(executed.response.body), { value: 'READY:JAVASCRIPT' });
    }

    assert.equal(compile('javascript', { applicationProjectMetadata: { crypto: {} } }).cryptoRealizationPlan.target, 'javascript');

    // A project-only helper must also stay rejected by Native's module linker;
    // an unsupported package must not be the reason this control passes.
    write('src/helpers.ts', `export const ready = 'ready';
      export async function value(input) { return [input, 'javascript'].map((part) => part.toUpperCase()).join(':'); }`);
    write('src/index.ts', sources[1]);
    assert.equal(compile('javascript').target, 'javascript');
    assert.throws(() => compile('native'), (e) => e.diagnostics.some((d) => d.code === 'PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED'));
    assert.equal(parseJson(run(['doctor', '--json'], root)).summary.failed, 0);
    assert.equal(parseJson(run(['test', '--json'], root)).summary.passed, 1);

    // JavaScript selection does not relax graph containment, lifecycle, or
    // canonical effect validation, and arbitrary target spellings fail closed.
    assert.throws(() => compile('JavaScript'), /target must be native or javascript/);
    write('src/index.ts', `export default async function handler(ctx) { await import('./helpers'); return ctx.json({}); }`);
    assert.throws(() => compile('javascript'), (e) => e.diagnostics.some((d) => d.code === 'PULSE_PROJECT_DYNAMIC_IMPORT_UNSUPPORTED'));
    write('src/index.ts', `export default async function handler(ctx) { const value = ctx.kv('store').get('key'); return ctx.json(value); }`);
    assert.throws(() => compile('javascript'), (e) => e.diagnostics.some((d) => d.code === 'PULSE_EFFECT_AWAIT_REQUIRED'));
    console.log('ok - explicit JavaScript compilation preserves package and relative imports through Router/plain roots, async execution, doctor/test/build and Native rejection');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
