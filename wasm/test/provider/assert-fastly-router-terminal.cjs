'use strict';
// P16 proves bounded Router placement through the ordinary compiler/provider.
// The host is injected: no transport delivery or actual-host claim is made.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const compiler = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const adapter = require('../../../packages/provider-fastly/src/build/host-extensions');
const execute = require('../support/terminal-host.cjs');
const observer = require('../support/terminal-observer.cjs');
const cliBuild = require('../support/terminal-cli.cjs');
const fixture = require('../support/host-extension-fixture.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-router-terminal-'));
const options = { cwd: root, maxDurationMs: 1000, bindings: { backends: { edge: 'edge_backend' } } };
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('ok - '+name); };
function source(body, extra = '', operation = 'handoffWebSocket') {
  return `import {Router} from '@pulse-compute/runtime'; import {${operation} as transfer} from '@pulse-compute/grip/experimental';
const app=new Router(); app.get('/health',async ctx=>ctx.text('ok',{status:201}));
app.get('/transfer',async ctx=>{${body}}); ${extra}
app.get('/transfer',async ctx=>ctx.text('must not resume')); export default app;`;
}
function compile(text, directory = dir, packageDirs = [path.join(root, 'packages/grip')]) {
  const file = path.join(directory, 'app.ts'); fs.writeFileSync(file, text);
  const compiled = compiler.compileCanonicalProject(file, { rootDir: directory, workspaceRoot: root, packageDirs, strict: false });
  return { plan: buildCanonicalNativePlan(compiled), realizationArtifacts: compiler.packageRealizationArtifactsForCompiled(compiled) };
}
function build(input, overrides = {}) {
  return platform.compileFastlyNativePlatformCapabilitiesPlan(input.plan, { ...options, realizationArtifacts: input.realizationArtifacts, ...overrides });
}
try {
  for (const [operation, abiName] of [['handoffWebSocket','redirect_to_websocket_proxy_v2'], ['handoffFanout','redirect_to_grip_proxy_v2']]) {
    const text = source("if(ctx.req.url === 'https://test.invalid/transfer?plain') return ctx.text('plain'); return transfer(ctx,'edge');", '', operation);
    const input = compile(text), native = build(input);
    const run = extra => execute(native.wasm, { abi: 'fastly_http_req', abiName, ...extra });
    check(operation+' dispatch and ordinary siblings/exhaustion', () => {
      const r=run(); assert.ifError(r.trap); assert.equal(r.error,0); assert.equal(r.calls,1); assert.deepEqual(r.sends,[]);
      assert.equal(r.closes.length,2); assert.equal(r.trace.filter(x=>x.kind==='dispatch')[0].backend,'edge_backend');
      for(const [route,status,body] of [['/health',201,'ok'],['/missing',404,'Not Found'],['/transfer?plain',200,'plain']]) {
        const normal=run({path:route});assert.ifError(normal.trap);assert.equal(normal.error,0);assert.equal(normal.calls,0);
        assert.deepEqual(normal.sends,[{status,body}]);assert.equal(normal.closes.length,2);
      }
      const wrongMethod=run({method:'POST'});assert.equal(wrongMethod.calls,0);assert.equal(wrongMethod.sends[0].status,404);
      assert.deepEqual(native.inspection.imports.filter(x=>x.name.startsWith('redirect_')).map(x=>x.name),[abiName]);
      assert.equal(native.manifest.hostExtensions.useSites.length,1);
    });
    check(operation+' uncertain outcomes and primary-error preservation',()=>{
      for(const fault of [{status:7},{trap:true}]) {
        const r=run({...fault,closeStatus:7});assert.equal(r.calls,1);assert.equal(r.sends.length,0);assert.equal(r.closes.length,0);
        if(fault.trap)assert(r.trap instanceof WebAssembly.RuntimeError);else {assert.equal(r.error,1003);assert.equal(r.stage,281);}
        r.instance.exports._start();assert.equal(r.calls,1);
      }
      const cleanup=run({closeStatus:7});assert.equal(cleanup.stage,285);assert.equal(cleanup.closes.length,2);assert.equal(cleanup.sends.length,0);
      cleanup.instance.exports._start();assert.equal(cleanup.closes.length,2);
      const normal=run({path:'/health',closeStatus:7});assert.equal(normal.sends.length,1);assert.equal(normal.sends[0].status,201);assert.equal(normal.closes.length,2);
    });
    check(operation+' original deadline before/after handoff',()=>{
      const pre=run({clock:n=>n<4?0:1001});assert.equal(pre.calls,0);assert.equal(pre.sends.length,1);assert.equal(pre.sends[0].status,504);
      let dispatched=false;
      const post=run({onDispatch:()=>{dispatched=true},clock:()=>dispatched?1001:0});
      assert.equal(post.calls,1);assert.equal(post.sends.length,0);assert.notEqual(post.error,0);assert.notEqual(post.stage,285);assert.equal(post.closes.length,2);
    });
    check(operation+' raw and stale completions cannot resume sibling routes',()=>{
      const forged=run({onDispatch:x=>assert.equal(x.pulse_set_effect_result(0,1),0),closeStatus:7});
      assert.notEqual(forged.error,0);assert.equal(forged.stage,284);assert.equal(forged.closes.length,2);assert.equal(forged.sends.length,0);assert.equal(forged.calls,1);
      const completed=run();assert.equal(completed.instance.exports.pulse_set_effect_result(0,completed.instance.exports.pulse_result_handle()),0);
      completed.instance.exports._start();assert.equal(completed.calls,1);assert.equal(completed.sends.length,0);
    });
    check(operation+' shared observation and ordinary CLI build',()=>{
      const observed=build(input,{lifecycleServices:observer()});
      const r=execute(observed.wasm,{abi:'fastly_http_req',abiName});assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),12345678);
      fs.mkdirSync(path.join(dir,'node_modules/@pulse-compute'),{recursive:true});
      const grip=path.join(dir,'node_modules/@pulse-compute/grip');if(!fs.existsSync(grip))fs.symlinkSync(path.join(root,'packages/grip'),grip);
      const bytes=cliBuild(dir,root,false),cli=execute(bytes,{abi:'fastly_http_req',abiName});
      assert.ifError(cli.trap);assert.equal(cli.calls,1);assert.equal(cli.sends.length,0);
    });
  }
  check('independent package uses identical Router service and ABI',()=>{
    const f=fixture({name:'@independent/router-terminal',version:'91.0.0',abi:'fastly_http_req',abiName:'redirect_to_grip_proxy_v2'});
    try {
      const text=source("return transfer(ctx,'edge');").replace("import {handoffWebSocket as transfer} from '@pulse-compute/grip/experimental'",`import {transfer} from '${f.name}'`);
      const input=compile(text,f.root,[f.pkg]),native=build(input,{lifecycleServices:observer()});
      const r=execute(native.wasm,{abi:'fastly_http_req',abiName:'redirect_to_grip_proxy_v2'});
      assert.ifError(r.trap);assert.equal(r.error,0);assert.equal(r.calls,1);assert.equal(r.sends.length,0);
      assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),12345678);
      assert.equal(native.manifest.hostExtensions.contributions[0].package,f.name);
    } finally {f.close();}
  });
  const negatives = [
    ['before-effect',source("await ctx.fetch('https://origin.test'); return transfer(ctx,'edge');")],
    ['after-effect',source("return transfer(ctx,'edge'); await ctx.fetch('https://origin.test');")],
    ['sibling-effect',source("return transfer(ctx,'edge');","app.get('/fetch',async ctx=>{return await ctx.fetch('https://origin.test')});")],
    ['middleware',source("return transfer(ctx,'edge');","app.use(async (ctx,next)=>{return next()});")],
    ['error-middleware',source("return transfer(ctx,'edge');","app.error(async (error,ctx,next)=>ctx.text('recovered'));")],
    ['parallel',source("const r=await ctx.parallel({a:transfer(ctx,'edge'),b:transfer(ctx,'edge')});return ctx.text('bad');")],
    ['escaped-token',source("const token=transfer(ctx,'edge');return token;")],
    ['multiple-routes',source("return transfer(ctx,'edge');","app.get('/second',async ctx=>{return transfer(ctx,'edge')});")],
    ['multiple-branches',source("if(ctx.req.method==='GET')return transfer(ctx,'edge');return transfer(ctx,'edge');")],
    ['helper',source("return helper(ctx);","async function helper(ctx){return transfer(ctx,'edge');}")],
    ['dynamic-backend',source("return transfer(ctx,ctx.req.path);")],
    ['wrong-context',source("return transfer({},'edge');")],
    ['next',source("return transfer(ctx,'edge');").replace("async ctx=>{return transfer(ctx,'edge');}","async (ctx,next)=>{if(ctx.req.path==='/skip')return next();return transfer(ctx,'edge');}")],
    ['state',source("ctx.state.set('x',1);return transfer(ctx,'edge');")]
  ];
  for(const [name,text] of negatives) check('reject '+name,()=>{
    assert.throws(()=>{const input=compile(text);platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(input.plan,{...options,realizationArtifacts:input.realizationArtifacts});},error=>{
      assert(error.code || error.diagnostics?.length,'structured compiler/provider rejection');return true;
    });
  });
  check('admission binds the effect to one route and rejects target mismatch',()=>{
    const input=compile(source("return transfer(ctx,'edge');"));
    for(const edit of [p=>p.effects[0].routerEntryStableId='missing',p=>p.effects[0].statementPath='entry.body[0]',p=>p.routing.entries[0].kind='middleware',p=>p.handlers[1].body.push(p.handlers[1].body.at(-1)),p=>p.stages=[{}],p=>p.helpers=[{}]]) {
      const p=structuredClone(input.plan);edit(p);assert.throws(()=>adapter.select(p,{...options,realizationArtifacts:input.realizationArtifacts}),{code:'PULSE_HOST_EXTENSION_PLACEMENT'});
    }
    for(const targetDescriptor of [{provider:'node',target:'native',targetId:'node-native'},{provider:'fastly',target:'javascript',targetId:'fastly-compute-javascript'}])
      assert.throws(()=>adapter.select(input.plan,{...options,realizationArtifacts:input.realizationArtifacts,targetDescriptor}),{code:'PULSE_HOST_EXTENSION_TARGET'});
  });
  check('absent and imported-unused Router controls omit terminal machinery',()=>{
    const absent="import {Router} from '@pulse-compute/runtime';const app=new Router();app.get('/health',async ctx=>ctx.text('ok'));export default app;";
    const unused=compile(source("return transfer(ctx,'edge');")).realizationArtifacts;
    for(const text of [absent,"import {handoffWebSocket} from '@pulse-compute/grip/experimental';"+absent,"import {handoff} from '@pulse-compute/grip';"+absent]) {
      const input=compile(text),c=build(input,{requirePlatformCapability:false});
      const withUnused=build(input,{requirePlatformCapability:false,realizationArtifacts:unused});
      // Compare matched plans: authored import changes legitimately alter plan IDs.
      assert.equal(c.source,withUnused.source);assert.deepEqual(c.wasm,withUnused.wasm);
      assert.deepEqual(c.inspection.imports,withUnused.inspection.imports);
      assert.equal(c.manifest.hostExtensions,undefined);assert.equal(withUnused.manifest.hostExtensions,undefined);
      assert.doesNotMatch(c.source,/__pulse_extension_|redirect_to_(grip|websocket)_proxy/);
    }
  });
  console.log(JSON.stringify({status:'passed',checks,qualification:'bounded Router placement; injected ABI only'}));
} finally {fs.rmSync(dir,{recursive:true,force:true});}
