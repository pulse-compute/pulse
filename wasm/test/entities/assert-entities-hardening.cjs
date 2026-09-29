#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWorkspacePackage } = require('../support/workspace-package-build.cjs');
buildWorkspacePackage('packages/entities');
const { run } = require('../cli/helpers.cjs');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root = path.resolve(__dirname, '../../..');
const temporary = path.join(root, 'wasm/.test-results');
fs.mkdirSync(temporary, { recursive: true });
const project = fs.mkdtempSync(path.join(temporary, 'entities-hardening-'));
const modes = ['node-javascript', 'fastly-javascript', 'node-native', 'fastly-native'];
const request = body => ({ method: 'POST', path: '/', headers: {'content-type':'application/json'}, body: typeof body === 'string' ? body : JSON.stringify(body) });
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) });
const result = (value, id = 1) => ({ status: 200, json: { jsonrpc: '2.0', result: value, id } });
const failure = (code, message, id = 1) => ({ status: 200, json: { jsonrpc: '2.0', error: { code, message }, id } });
const value = { name: '雪😀', nested: {}, tags: [{}, { note: null }, { note: 'present' }] };
const privateToken = 'en04-private-error-sentinel';
const cases = [
  { name: 'optional-absent', body: rpc('echo', { name: 'Ada' }), expect: result({ name: 'Ada' }) },
  { name: 'nested-optional-nullable', body: rpc('echo', { ...value, ignored: 'drop' }), expect: result(value) },
  { name: 'optional-wrong-type', body: rpc('echo', { name: 'Ada', nested: { note: 1 } }), expect: failure(-32602, 'Invalid params') },
  { name: 'required-missing', body: rpc('echo', {}), expect: failure(-32602, 'Invalid params') },
  { name: 'invalid-output', body: rpc('invalid'), expect: failure(-32603, 'Internal error') },
  { name: 'optional-output', body: rpc('output'), expect: result({ name: 'Ada', nested: {}, tags: [{}] }) },
  { name: 'output-within-entity-limit', body: rpc('large'), config: { LARGE: 'x'.repeat(600) }, expect: result({ name: 'x'.repeat(600) }) },
  { name: 'unknown-before-params', body: rpc('missing', [1]), expect: failure(-32601, 'Method not found') },
  { name: 'selected-positional', body: rpc('echo', [1]), expect: failure(-32602, 'Invalid params') },
  { name: 'malformed', body: '{', expect: failure(-32700, 'Parse error', null) },
  { name: 'duplicate-envelope', body: '{"jsonrpc":"2.0","method":"echo","method":"invalid","id":1}', expect: failure(-32600, 'Invalid Request', null) },
  { name: 'notification-completion', body: { jsonrpc: '2.0', method: 'notify' }, expect: { status: 204, text: '' } },
  { name: 'notification-invalid-output', body: { jsonrpc: '2.0', method: 'invalid' }, expect: { status: 204, text: '' } },
  { name: 'effect-failure', body: rpc('failed'), expect: failure(-32603, 'Internal error') },
  { name: 'notification-effect-failure', body: { jsonrpc: '2.0', method: 'failed' }, expect: { status: 204, text: '' } },
  { name: 'secret-log', body: rpc('secret'), secrets: { TOKEN: privateToken }, expect: result({ name: 'safe' }) },
];
function write(relative, text) { const file = path.join(project, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function command(args, success = true) {
  const execution = run([...args, '--json'], project, { timeout: 90000 });
  let data; try { data = JSON.parse(execution.stdout || execution.stderr); } catch { throw new Error(execution.stderr || execution.stdout); }
  if (success) assert.equal(execution.status, 0, JSON.stringify({ error: data.error, cases: data.cases?.filter(c => c.status !== 'passed') }));
  else assert.notEqual(execution.status, 0);
  return data;
}
const schema = `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';
interface Value { name: string; nested?: { note?: string }; tags?: Array<{ note?: string | null }> }
export default defineSchemaRegistry({ schemas: { 'app.Value': schema<Value>() } });`;
const source = `import { EntityRouter, jsonRpc } from '@pulse-compute/entities';
const rpc = new EntityRouter({ adapter: jsonRpc() });
async function echo(ctx:any, input:any) { const selected = await ctx.config.get('SELECTED'); return input }
async function unselected(ctx:any, _input:any) { const value = await ctx.config.get('UNSELECTED'); return {name:value} }
function invalid(_ctx:any, _input:any) { return {name:7} }
function output(_ctx:any, _input:any) { return {name:'Ada',nested:{},tags:[{}]} }
async function large(ctx:any, _input:any) { const value = await ctx.config.get('LARGE'); return {name:value} }
async function notify(ctx:any, _input:any) { const completed = await ctx.config.get('NOTIFY'); return undefined }
async function failed(ctx:any, _input:any) { const value = await ctx.fetch('https://failure.example.test/value').text(); return {name:value} }
async function secret(ctx:any, _input:any) { const token = await ctx.secret.get('TOKEN'); ctx.log.info(token); return {name:'safe'} }
rpc.on('echo',{input:'app.Value',output:'app.Value'},echo);
rpc.on('unselected',{input:null,output:'app.Value'},unselected);
rpc.on('invalid',{input:null,output:'app.Value'},invalid);
rpc.on('output',{input:null,output:'app.Value'},output);
rpc.on('large',{input:null,output:'app.Value'},large);
rpc.on('notify',{input:null,output:null},notify);
rpc.on('failed',{input:null,output:'app.Value'},failed);
rpc.on('secret',{input:null,output:'app.Value'},secret);
export default function handler(ctx:any) { return rpc.handle(ctx) }
`;
async function main() {
  try {
    write('node_modules/@pulse-compute/.keep', '');
    fs.symlinkSync(path.join(root, 'packages/entities'), path.join(project, 'node_modules/@pulse-compute/entities'), 'dir');
    write('.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>({
      pulse:{entry:'src/index.ts',schema:'src/schemas.ts',tests:'tests/pulse.harness.ts',strict:true},
      ${modes.map(mode => `${JSON.stringify(mode)}:{host:${JSON.stringify(mode.split('-')[0])},target:${JSON.stringify(mode.split('-')[1])},outDir:'dist-${mode}',schemas:{maxBytes:512},dev:{networkFetch:false},${mode.startsWith('fastly') ? "fastly:{bindings:{configStore:'pulse_config',secretStore:'pulse_secrets',backends:{'https://failure.example.test':'failure_backend'},dynamicBackends:false}}" : ''}}`).join(',')}
    }));`);
    write('src/schemas.ts', schema); write('src/index.ts', source);
    write('tests/pulse.harness.ts', `export default {cases:${JSON.stringify(cases.map(test => ({ ...test, request: request(test.body), body: undefined })))}}`);
    for (const mode of modes) {
      const tested = command(['test', '--profile', mode]);
      assert.deepEqual(tested.summary, { total: cases.length, passed: cases.length, failed: 0 });
      assert.ok(!JSON.stringify(tested).includes(privateToken));
      console.log(`ok - ${mode}: ${cases.length} ordinary Entities contract cases`);
    }
    // Read the ordinary emitted artifacts for selected-only and drain evidence.
    for (const mode of ['node-native', 'fastly-native']) {
      command(['build', '--profile', mode]);
      const out = path.join(project, 'dist-' + mode);
      const native = { wasm: fs.readFileSync(path.join(out, mode === 'node-native' ? 'canonical-native.wasm' : 'bin/main.wasm')),
        plan: JSON.parse(fs.readFileSync(path.join(out, mode === 'node-native' ? 'canonical-native-plan.json' : 'fastly-native-plan.json'))) };
      const execute = async (body, options = {}) => {
        const settings = { maxRequestBodyBytes: 2048, maxStructuredBodyBytes: 2048, request: request(body), config: { SELECTED: 'yes', NOTIFY: 'done' }, ...options };
        return mode === 'node-native' ? executeCanonicalNativeModule(native, { ...settings, providerAdapter: createNodeProviderAdapter(settings) })
          : executeFastlyNativePlatformCapabilities(native, { ...settings, configStore: 'pulse_config', secretStore: 'pulse_secrets' });
      };
      for (const [body, invoked] of [[rpc('echo', value), true], [rpc('echo', {}), false], [rpc('missing', [1]), false], [{ jsonrpc:'2.0',method:'notify' }, true]]) {
        const response = await execute(body);
        if (mode === 'node-native') assert.equal(response.effectCount, invoked ? 1 : 0);
        else {
          const gets = response.trace.filter(event => event.module === 'fastly_config_store' && event.name === 'get');
          assert.equal(gets.length, invoked ? 1 : 0); assert.ok(gets.every(event => event.key !== 'UNSELECTED'));
          assert.equal(response.instance.exports.pulse_entities_pending_count(), 0);
          assert.equal(response.instance.exports.pulse_entities_invocation_count(7), 0); // unselected is last in the static table.
        }
      }
      const bounded = await execute(rpc('echo', {name:'雪'.repeat(184)}));
      if (mode === 'node-native') { assert.equal(JSON.parse(bounded.response.body).error.code, -32602); assert.equal(bounded.effectCount, 0); }
      else assert.equal(bounded.response.status, 413); // Provider request-body limit precedes envelope admission.
      const redacted = await execute(rpc('secret'), { secrets: { TOKEN: privateToken } });
      assert.ok(!JSON.stringify(redacted).includes(privateToken));
    }
    // Newer dynamic schema families work in JavaScript. Native explicitly
    // refuses policies it cannot preserve, and discovery reports that decision.
    write('src/index.ts', `import {EntityRouter,jsonRpc} from '@pulse-compute/entities';const rpc=new EntityRouter({adapter:jsonRpc()});function echo(_ctx:any,input:any){return input}rpc.on('echo',{input:'app.Value',output:'app.Value'},echo);export default function handler(ctx:any){return rpc.handle(ctx)}`);
    const dynamic = { name:'Ada', properties:{'雪':[true,{nested:null}]}, data:[1,'x'], record:{answer:42}, extra:{kept:true} };
    write('src/schemas.ts', `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {OpenObject,JsonObject,JsonValue,ScalarRecord} from '@pulse-compute/pulse/schema';type Value=OpenObject<{name:string;properties:JsonObject;data?:JsonValue;record:ScalarRecord}>;export default defineSchemaRegistry({schemas:{'app.Value':schema<Value>({json:{maxStringLength:8,maxDepth:5}})}})`);
    const dynamicCases = [
      {name:'nested-json',request:request(rpc('echo',dynamic)),expect:result(dynamic)},
      {name:'nested-invalid',request:request(rpc('echo',{...dynamic,properties:1})),expect:failure(-32602,'Invalid params')},
      {name:'limit',request:request(rpc('echo',{...dynamic,name:'x'.repeat(9)})),expect:failure(-32602,'Invalid params')},
      {name:'duplicate-dynamic',request:request('{"jsonrpc":"2.0","method":"echo","params":{"name":"Ada","properties":{"x":1,"x":2},"record":{}},"id":1}'),expect:failure(-32602,'Invalid params')},
    ];
    write('tests/pulse.harness.ts', `export default {cases:${JSON.stringify(dynamicCases)}}`);
    for (const mode of modes.filter(mode => mode.endsWith('javascript'))) assert.equal(command(['test','--profile',mode]).summary.passed, dynamicCases.length);
    const inspected = command(['inspect','--profile','node-javascript']);
    const artifacts = inspected.compiler.packageInspection.artifacts;
    const catalog = artifacts.find(a => a.id === 'pulse.entities-catalog.v1').data;
    const inspection = artifacts.find(a => a.id === 'pulse.entities-inspection.v1').data;
    assert.equal(catalog.routers[0].entities[0].inputSchema, 'app.Value');
    for (const mode of modes) {
      assert.equal(catalog.routers[0].entities[0].eligibility[mode], mode.endsWith('javascript'));
      if (mode.endsWith('native')) {
        assert.equal(inspection.targets[mode].eligible, false);
        assert.equal(inspection.targets[mode].runtimeExecutionMeasured, false);
        const error = command(['build','--profile',mode], false).error;
        assert.equal(error.code, 'PULSE_ENTITIES_TARGET_INELIGIBLE');
        assert.equal(error.detail.schemaId, 'app.Value'); assert.equal(error.detail.automaticFallback, false);
      }
    }
    console.log('ok - nested JavaScript schemas enforce limits; Native eligibility and owning diagnostics agree without fallback');
  } finally { fs.rmSync(project, { recursive:true,force:true }); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
