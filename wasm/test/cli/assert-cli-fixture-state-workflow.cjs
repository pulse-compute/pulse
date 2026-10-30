#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { startDevServer } = require('../../packages/cli/src/project-execution');
const { createCommandReporter } = require('../../packages/cli/src/internal/command-reporter');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fixture-state-'));
const privateValue = 'PRIVATE_FIXTURE_CANARY';
let dev;
async function main() {
  try {
    for (const dir of ['src', '.pulse']) fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',defaultProfile:'local',strict:false},local:{host:'fastly',target:'native',dev:{networkFetch:false,kv:{authority:{seed:{value:'PRIVATE_FIXTURE_CANARY'}}}},fastly:{bindings:{kv:{authority:'fixture_state'}}}}}));`);
    const source = `import { Pulse } from '@pulse-compute/pulse';
const app = new Pulse({auto:true});
app.post('/write', async ctx => {
  const store = ctx.kv<{value:string}>('authority');
  const stored = await store.insertIfAbsent('new', {value:'write-B'});
  const read = await store.getVersioned('new');
  if (read.status === 'found') return ctx.json({stored:stored.status, read:read.status, value:read.value.value});
  return ctx.json({stored:stored.status, read:read.status});
});
app.get('/read', async ctx => {const read = await ctx.kv<{value:string}>('authority').getVersioned('new');return ctx.json({status:read.status});});
app.post('/seed', async ctx => {
  const store = ctx.kv<{value:string}>('authority');
  const read = await store.getVersioned('seed');
  if (read.status === 'found') {
    const changed = await store.compareAndSwap('seed', read.generation, {value:'mutated'});
    return ctx.json({value:read.value.value, changed:changed.status});
  }
  return ctx.json({status:read.status});
});
export default app;`;
    fs.writeFileSync(path.join(root, 'src/index.ts'), source);
    const events = [];
    let onReload;
    dev = await startDevServer(resolveProject({cwd:root}), {port:0, watch:true, onEvent:event=>{events.push(event);if(event.event==='reloaded') onReload?.(event);}});
    const evidence = dev.ready.executionEvidence;
    assert.equal(evidence.kind, 'fastly-native-fixture-abi');
    assert.equal(evidence.providerRealityValidated, false);
    assert.deepEqual(evidence.kvFixture, {lifetime:'invocation',initialization:'supplied-fixtures',crossRequestPersistence:false});
    assert.match(evidence.wasmSha256, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(events).includes(privateValue));
    const call = async (route, method='GET') => {const response = await fetch(dev.ready.url+route,{method});assert.equal(response.status,200);return response.json();};
    assert.deepEqual(await call('/write','POST'), {stored:'stored',read:'found',value:'write-B'});
    assert.deepEqual(await call('/read'), {status:'not-found'});
    // Both invocations start from the original fixture despite successful CAS.
    for (let i=0;i<2;i++) assert.deepEqual(await call('/seed','POST'), {value:privateValue,changed:'stored'});
    assert.deepEqual(await call('/write','POST'), {stored:'stored',read:'found',value:'write-B'});
    const waitReload = new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('reload timeout')),15000);onReload=e=>{clearTimeout(timer);resolve(e);};});
    fs.writeFileSync(path.join(root, 'src/index.ts'), source+'\n// reload fixture\n');
    const reloaded = await waitReload;
    assert.deepEqual(reloaded.executionEvidence.kvFixture, evidence.kvFixture);
    assert.deepEqual(await call('/read'), {status:'not-found'});
    let human='', json='';
    const reporter = createCommandReporter({stdout:{write:text=>{human+=text;}}});
    reporter.reportEvent({command:'dev'},dev.ready);
    assert(human.includes('fastly-native-fixture-abi'));
    assert(human.includes('writes do not persist across requests'));
    assert(human.includes('provider reality validated: false'));
    assert(human.includes('Fastly CLI/Viceroy'));
    reporter.reportEvent({command:'dev'}, {event:'request',executionEvidence:evidence});
    assert.equal(human.match(/writes do not persist/g).length,1);
    createCommandReporter({stdout:{write:text=>{json+=text;}}}).reportEvent({command:'dev',json:true},dev.ready);
    assert.deepEqual(JSON.parse(json).executionEvidence,evidence);
    assert(!human.includes(privateValue) && !json.includes(privateValue));
    const leave = new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('reload timeout')),15000);onReload=e=>{clearTimeout(timer);resolve(e);};});
    fs.writeFileSync(path.join(root, 'src/index.ts'), `export default async function handler(ctx) { return ctx.text('plain'); }`);
    assert.equal((await leave).executionEvidence,null);
    assert.equal(await (await fetch(dev.ready.url)).text(),'plain');
    console.log('ok - exact Fastly Native fixture write/read, per-invocation seed reset, startup/JSON/human disclosure, reload transitions, no fixture disclosure or per-request warnings');
  } finally {
    if (dev) {dev.server.closeAllConnections(); await new Promise(resolve=>dev.server.close(resolve));}
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
