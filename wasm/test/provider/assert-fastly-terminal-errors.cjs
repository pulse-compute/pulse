'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {plan, request} = require('../runtime/assert-native-context-primitives.cjs');
const {compileFastlyNativePlatformCapabilitiesPlan: compile} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const {executeFastlyNativePlatformCapabilities: execute} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');

function rejected(run, code, stage) {
  assert.throws(run, error => {
    assert.equal(error.code, 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED');
    assert.equal(error.detail.lastError, code, 'retain original diagnostic');
    assert.equal(error.detail.errorStage, stage);
    const trace = error.detail.trace;
    assert.equal(trace.filter(x => x.name === 'send_downstream').length, 1, 'send exactly one terminal response');
    assert.deepEqual(trace.filter(x => x.name === 'status_set').map(x => x.status), [500]);
    assert(!trace.some(x => x.module === 'fastly_secret_store'), 'no later protected effect');
    return true;
  });
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const p = plan(`export default function handler(ctx) {
    const mode = ctx.req.header('mode') ?? '';
    const cells = ctx.workspace.numbers(2);
    const data = ctx.resources.map('data');
    if (mode === 'workspace') cells[-1] = 1;
    if (mode === 'resource') return ctx.json({value:data.readU32LE(data.byteLength)});
    return ctx.text('healthy');
  }`, Buffer.from([1,2,3,4]));
  let checks = 0;
  // Generic failures must not depend on the optional JWT evidence build mode.
  for (const enabled of [false, true]) {
    const native = compile(p, {cwd:root, canonicalBuild:true, requirePlatformCapability:false, jwtReality:{enabled}});
    for (const [mode, stage] of [['workspace',280], ['resource',270]]) {
      rejected(() => execute(native, {request:request({mode})}), 1001, stage); checks++;
      assert.equal(execute(native, {request:request()}).response.body, 'healthy'); checks++;
    }
  }
  const tc = acceptanceToolchain(), dir = fs.mkdtempSync(path.join(root,'.terminal-error-proof-'));
  try {
    fs.mkdirSync(path.join(dir,'src')); fs.mkdirSync(path.join(dir,'.pulse'));
    fs.writeFileSync(path.join(dir,'.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(_ => ({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{maxDurationMs:5000,bindings:{configStore:'expected',secretStore:'secrets'}}}}));`);
    for (const routerError of [false, true]) {
      fs.writeFileSync(path.join(dir,'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
const app = new Pulse({auto:true});
app.get('/', async ctx => {const value = await ctx.config.get('VALUE'); await ctx.secret.get('LATER'); return ctx.text(value ?? 'healthy');});
${routerError ? "app.error(async (error,ctx,next) => ctx.text('must-not-recover',{status:422}));" : ''}
export default app;`);
      const native = tc.compileFastly(tc.resolveProject({cwd:dir,profile:'proof'}));
      rejected(() => execute(native, {request:request(), configStore:'different', kvStores:{proof:{}}}), 1003, 110); checks++;
      const healthy = execute(native, {request:request(),configStore:'expected',config:{VALUE:'healthy'},secretStore:'secrets',secrets:{LATER:'unused'}});
      assert.equal(healthy.response.status,200); assert.equal(healthy.response.body,'healthy'); checks++;
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
  console.log(`ok - ${checks} Fastly terminal bounds/effect failure and fresh-request recovery checks`);
}
module.exports = {main};
if (require.main === module) main();
