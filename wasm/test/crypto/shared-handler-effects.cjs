'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');

// Run inside multifile-source-identity: one small artifact per Native provider,
// with repeated source calls and registrations sharing those artifacts.
async function main(options = {}) {
  const tc = acceptanceToolchain(options.packedRoot);
  const repo = path.resolve(__dirname, '../../..');
  const cwd = fs.mkdtempSync(path.join(options.packedRoot || __dirname, '.shared-effects-'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, '.pulse'));
    if (options.packedRoot) fs.symlinkSync(path.join(options.packedRoot, 'node_modules'), path.join(cwd, 'node_modules'), 'junction');
    else {
      fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
      for (const name of ['pulse', 'crypto', 'grip']) fs.symlinkSync(path.join(repo, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    }
    fs.writeFileSync(path.join(cwd, 'src/shared.ts'), `import {crypto} from '@pulse-compute/crypto'
import {grip} from '@pulse-compute/grip'
const shared=async(ctx,next)=>{
  const first=await crypto.digestText(ctx,ctx.req.header('x-input')||'')
  const second=await crypto.digestText(ctx,ctx.req.header('x-input')||'')
  if(first.status!=='ok'||second.status!=='ok')return ctx.text('digest failed',{status:503})
  const prior=ctx.state.get('chain')||''
  ctx.state.set('chain',prior+first.sha256+':'+second.byteLength+':'+(grip.isWebSocket(ctx.req)?'ws':'http')+';')
  if(ctx.req.header('x-stop')==='yes')return ctx.text('stopped|'+ctx.state.get('chain'),{status:409})
  if(ctx.req.header('x-error')==='yes')return next({code:'SHARED_ERROR',message:'shared error'})
  return next()
}
export default shared
`);
    fs.writeFileSync(path.join(cwd, 'src/terminal.ts'), `import {crypto} from '@pulse-compute/crypto'
const terminal=async(ctx)=>{
  const chain=ctx.state.get('chain')||''
  const result=await crypto.digestText(ctx,chain)
  if(result.status!=='ok')return ctx.text('digest failed',{status:503})
  return ctx.text(chain+'|'+result.sha256)
}
export default terminal
`);
    fs.writeFileSync(path.join(cwd, 'src/recover.ts'), `const recover=async(error,ctx,next)=>{
  const chain=ctx.state.get('chain')||''
  if(ctx.state.get('recover')===undefined){ctx.state.set('recover',chain);return next(error)}
  return ctx.text(error.code+'|'+ctx.state.get('recover')+'|'+chain,{status:418})
}
export default recover
`);
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse'
import shared from './shared'
import terminal from './terminal'
import recover from './recover'
const app=new Pulse({auto:true})
app.post('/chain',shared)
app.use(shared)
app.post('/chain',terminal)
app.post('/other',shared)
app.post('/other',terminal)
app.post('/repeat',terminal)
app.error(recover)
app.error(recover)
export default app
`);
    const config = { pulse: { entry: 'src/index.ts', strict: false, crypto: ['SHA-256'] } };
    for (const [host, target] of [['node', 'native'], ['node', 'javascript'], ['fastly', 'native']]) config[`${host}-${target}`] = { host, target };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const resolve = profile => tc.resolveProject({ cwd, profile });
    const entryFile = path.join(cwd, 'src/index.ts');
    const source = fs.readFileSync(entryFile, 'utf8');
    for (const [kind, unused] of [
      ['crypto.digestText', "import {crypto} from '@pulse-compute/crypto';const unused=async(ctx)=>{const value=await crypto.digestText(ctx,'unmapped');return ctx.text(value.status)}"],
      ['grip.isWebSocket', "import {grip} from '@pulse-compute/grip';const unused=(ctx)=>ctx.text(grip.isWebSocket(ctx.req)?'ws':'http')"],
    ]) {
      fs.writeFileSync(entryFile, source + unused);
      assert.throws(() => tc.compileProject(resolve('node-native')), error => {
        assert.equal(error.code, 'PULSE_PACKAGE_EFFECT_SOURCE_LINK_FAILED');
        assert.equal(error.detail.missing.length, 1);
        assert.equal(error.detail.missing[0].kind, kind, 'Repeated generated sites cannot conceal an unlinked source contribution');
        return true;
      });
    }
    fs.writeFileSync(entryFile, source);
    const project = resolve('node-native');
    const node = tc.compileNativeProjectInMemory(project);
    const fastly = tc.compileFastly(resolve('fastly-native'));
    const js = tc.prepareJavascriptApplication(resolve('node-javascript'));
    const sites = node.compiled.metadata.effectSites;
    assert.equal(node.compiled.metadata.packageEffectCount, 3, 'Three authored calls remain three package contributions');
    assert.equal(sites.length, 9, 'Each registration owns every generated call, including identical calls');
    assert.equal(new Set(sites.map(site => site.id)).size, 9);
    assert.equal(new Set(node.plan.continuations.map(site => site.id)).size, 9);
    const entries = node.compiled.metadata.router.entries;
    for (const [index, count, file] of [[0, 2, 'shared'], [1, 2, 'shared'], [2, 1, 'terminal'], [3, 2, 'shared'], [4, 1, 'terminal'], [5, 1, 'terminal'], [6, 0, 'recover'], [7, 0, 'recover']]) {
      const owned = sites.filter(site => site.routerEntryStableId === entries[index].stableId);
      assert.equal(owned.length, count, `entry ${index}: distinct generated sites`);
      assert.deepEqual(owned.map(site => site.position.file), Array(count).fill(`src/${file}.ts`));
      assert.equal(new Set(owned.map(site => site.generatedPosition.offset)).size, count);
      const continuations = node.plan.continuations.filter(site => site.routerEntryStableId === entries[index].stableId);
      assert.equal(continuations.length, count, `entry ${index}: continuation ownership`);
      if (file === 'terminal') assert.equal(node.plan.handlers.find(handler => handler.id === entries[index].stableId).source.file, 'src/terminal.ts');
    }
    // Recompiling the same project must not depend on previous site allocations.
    const repeated = tc.compileProject(resolve('node-native'));
    assert.deepEqual(repeated.metadata.effectSites, sites);
    assert.equal(repeated.generatedSource, node.compiled.generatedSource);
    const inputs = [
      { path: '/chain', input: 'alpha', stages: 2 },
      { path: '/other', input: 'different input', stages: 2 },
      { path: '/repeat', input: 'beta', stages: 1 },
      { path: '/chain', input: 'stop', stop: true, stages: 1 },
      { path: '/other', input: 'error', error: true, stages: 1 },
      { path: '/chain', input: 'after-error', stages: 2 },
    ];
    let executions = 0;
    for (const row of inputs) {
      const chain = `${hash(row.input)}:${Buffer.byteLength(row.input)}:http;`.repeat(row.stages);
      const expected = row.stop ? `stopped|${chain}` : row.error ? `SHARED_ERROR|${chain}|${chain}` : `${chain}|${hash(chain)}`;
      const request = { method: 'POST', path: row.path, url: 'https://shared.test' + row.path, headers: [['x-input', row.input], ...(row.stop ? [['x-stop', 'yes']] : []), ...(row.error ? [['x-error', 'yes']] : [])] };
      for (const profile of ['node-native', 'node-javascript', 'fastly-native']) {
        let response;
        if (profile === 'node-native') ({ response } = await tc.executeCanonicalNativeModule(node.native, tc.driver.executionOptions(project.providerConfig, { request, strict: false })));
        else if (profile === 'fastly-native') ({ response } = tc.executeFastlyNativePlatformCapabilities(fastly, { request }));
        else {
          const result = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: 'POST', headers: request.headers }), { strict: false });
          response = { status: result.status, body: await result.text() };
        }
        assert.equal(response.status, row.stop ? 409 : row.error ? 418 : 200, `${profile}: ${row.path}`);
        assert.equal(response.body, expected, `${profile}: ${row.path}, ${row.input}`);
        executions++;
      }
    }
    return { status: 'passed', executions, authoredEffects: 3, generatedEffects: sites.length };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

module.exports = { main };
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.stack || error); console.error(JSON.stringify(error.diagnostics)); process.exitCode = 1; });
