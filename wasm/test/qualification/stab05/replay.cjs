'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { run } = require('../../cli/helpers.cjs');
const { buildCanonicalNativePlan, validateCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const { describeDiagnostic, DIAGNOSTICS_REFERENCE, diagnosticAnchor } = require('../../../packages/cli/src/diagnostics');
const { writeControl } = require('../stab03/fixture.cjs');
const fixtures = require('./fixtures.cjs');

const repo = path.resolve(__dirname, '../../../..');
const tc = acceptanceToolchain();
const argument = 'PULSE_NATIVE_PURE_HELPER_ARGUMENT_UNSUPPORTED';
const signature = 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED';
const rejections = {
  'unguarded-optional': argument,
  'record-spread': argument,
  'array-element-field': argument,
  'array-element-loop': argument,
  'string-array-parameter': signature,
  'record-array-parameter': signature,
  'nullable-record-parameter': signature,
  'structured-return': signature,
  'combined-loop-limit': 'PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED',
  // This remains an independent-plan rejection, not good source diagnostics.
  'write-call-in-loop': 'PULSE_CANONICAL_NATIVE_PLAN_INVALID',
  'generic-record-schema': 'PULSE_SCHEMA_GENERIC_TYPE_UNSUPPORTED',
  'index-signature-schema': 'PULSE_SCHEMA_OBJECT_MEMBER_UNSUPPORTED',
  'json-object-schema': 'PULSE_SCHEMA_ROOT_OBJECT_REQUIRED',
};

function publicDiagnostic(value, code) {
  const descriptor = describeDiagnostic(code);
  assert.equal(value.code, code);
  for (const key of ['title', 'summary', 'category', 'remediation', 'stability', 'scope', 'docs']) {
    assert.deepEqual(value[key], descriptor[key], `${code}: ${key}`);
  }
  assert.equal(value.scope, 'public');
  assert.equal(value.stability, 'preview-stable');
  assert.equal(descriptor.exitCode, 3);
  assert.equal(value.docs, `${DIAGNOSTICS_REFERENCE}#${diagnosticAnchor(code)}`);
  assert.ok(value.remediation.length);
}

function write(root, fixture) {
  fs.writeFileSync(path.join(root, 'helper.ts'), fixture.helper || 'export {};');
  fs.writeFileSync(path.join(root, 'app.ts'), `import {Pulse} from '@pulse-compute/pulse';
${fixture.helper ? "import {check} from './helper';" : ''}
const app=new Pulse({auto:true});app.get('/',async ctx=>{${fixture.body}});export default app;`);
  fs.writeFileSync(path.join(root, 'schemas.ts'), `import {schema,defineSchemaRegistry} from '@pulse-compute/pulse/schema';
import type {JsonObject} from '@pulse-compute/pulse/schema';
export default defineSchemaRegistry({schemas:{'case.Input':schema<${fixture.schema || '{value:string}'}>()}});`);
  fs.writeFileSync(path.join(root, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig((_scope)=>({pulse:{entry:'app.ts',strict:false,${fixture.schema ? "schema:'schemas.ts'," : ''}}
,node:{host:'node',target:'native'}}));`);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-stab05-'));
  const cases = [], controls = [];
  try {
    fs.mkdirSync(path.join(root, '.pulse'));
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
    const names = ['pulse', 'runtime', 'crypto', 'jwt', 'provider-node'];
    for (const name of names) fs.symlinkSync(path.join(repo, 'packages', name), path.join(root, 'node_modules/@pulse-compute', name), 'dir');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'stab05-replay', private: true,
      dependencies: Object.fromEntries(names.map(name => [`@pulse-compute/${name}`, require(path.join(repo, 'packages', name, 'package.json')).version])) }));
    for (const fixture of fixtures) {
      write(root, fixture);
      const compile = () => buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({ cwd: root, profile: 'node' })));
      const code = rejections[fixture.id];
      if (code) {
        assert.throws(compile, error => error.code === code || error.diagnostics?.some(item => item.code === code), fixture.id);
        const result = run(['inspect', root, '--profile', 'node', '--json'], repo);
        assert.equal(result.status, 3, `${fixture.id}: ${result.stderr}`);
        const error = JSON.parse(result.stderr).error;
        const diagnostic = error.code === code ? error : error.diagnostics?.find(item => item.code === code);
        assert.ok(diagnostic, fixture.id);
        if (fixture.id !== 'write-call-in-loop') publicDiagnostic(diagnostic, code);
        else assert.match(diagnostic.message, /read loop helper effect kind is not admitted/);
        if (code === argument) {
          assert.equal(diagnostic.detail.arguments[0].expected, 'string');
          assert.equal(diagnostic.detail.arguments[0].actual, fixture.id === 'unguarded-optional' ? 'string-or-undefined' : 'unknown');
          assert.ok(diagnostic.file && diagnostic.position.line > 0);
        }
        if (code === signature) {
          publicDiagnostic(error, 'PULSE_CANONICAL_ROUTER_COMPILE_FAILED');
          assert.equal(diagnostic.file, 'helper.ts');
          assert.equal(diagnostic.position.line, 1);
        }
        cases.push({ id: fixture.id, status: 'rejected', code, diagnosticQuality: fixture.id === 'write-call-in-loop' ? 'plan-only-gap' : 'public' });
      } else {
        const plan = compile();
        validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
        assert.equal(compile().planHash, plan.planHash, `${fixture.id}: deterministic plan`);
        const native = compileCanonicalNativePlan(plan, { cwd: repo });
        assert.equal(native.manifest.wat.emitted, false, 'default compilation must not emit WAT');
        assert.equal(native.wat, '');
        const keys = [];
        const result = await tc.executeCanonicalNativeModule(native, {
          request: { method: 'GET', path: '/', url: 'https://replay.test/', headers: [], body: '' }, strict: false,
          providerAdapter: { id: 'stab05', dispatchEffect(effect) {
            assert.equal(effect.kind, 'kv.getVersioned'); keys.push(effect.key);
            return { status: 'found', value: 'value', generation: 'g' };
          } }
        });
        assert.equal(result.response.status, 200);
        const expected = fixture.id === 'read-call-in-loop' ? '4' : fixture.id === 'guarded-optional' ? 'absent' : fixture.id === 'nested-json-object-schema' ? 'decoded' : 'true';
        assert.equal(result.response.body, expected, fixture.id);
        assert.deepEqual(keys, fixture.id === 'read-call-in-loop' ? ['0', '1', '2', '3'] : []);
        cases.push({ id: fixture.id, status: 'executed', target: 'node-native', planHash: plan.planHash });
      }
    }
    // Real CLI builds, not synthetic exceptions: both independent allocating
    // compositions must retain their failure code and obtain compile exit 3.
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture' };
    for (const kind of ['baseline', 'mac', 'schema']) {
      fs.rmSync(path.join(root, 'schemas.ts'), { force: true });
      writeControl(root, jwk, kind);
      const result = run(['build', root, '--profile', 'node-native', '--json'], repo, { timeout: 120000 });
      if (kind === 'baseline') {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).status, 'built');
        controls.push({ id: kind, status: 'built', target: 'node-native' });
      } else {
        assert.equal(result.status, 3, result.stderr);
        const error = JSON.parse(result.stderr).error;
        publicDiagnostic(error, 'PULSE_GUEST_UNIT_START_MISMATCH');
        assert.equal(error.message, 'Primary module has a forbidden start section.');
        controls.push({ id: kind, status: 'blocked', target: 'node-native', code: error.code, exitCode: result.status });
      }
    }
    const human = run(['build', root, '--profile', 'node-native'], repo, { timeout: 120000 });
    assert.equal(human.status, 3, human.stderr);
    assert.match(human.stderr, /help:/);
    assert.ok(human.stderr.includes(describeDiagnostic('PULSE_GUEST_UNIT_START_MISMATCH').docs));
    console.log(JSON.stringify({ status: 'passed', cases, controls,
      qualification: 'workspace Node Native replay; no installed, hosted, full-application or performance qualification' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const keep = setInterval(() => {}, 1000);
main().catch(error => { console.error(error, error.diagnostics); process.exitCode = 1; }).finally(() => clearInterval(keep));
