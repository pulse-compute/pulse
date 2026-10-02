'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const root = path.resolve(__dirname, '../../..');
const tc = acceptanceToolchain();
async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-pf02-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));`);
    function compile(helper, body, imported = true, method = 'get') {
      fs.writeFileSync(path.join(cwd, 'src/helper.ts'), helper);
      fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
${imported ? "import {isPositive} from './helper';" : helper}
const app=new Pulse({auto:true});app.${method}('/',async(ctx)=>{${body}});export default app;`);
      const project = tc.resolveProject({ cwd, profile: 'node' });
      const compiled = tc.compileProject(project);
      const plan = buildCanonicalNativePlan(compiled);
      return { plan, compiled };
    }
    const scalar = `export function isPositive(value:number):boolean { return value > 0; }`;
    const substantial = `export function isPositive(value:number):number {
      if(value < 0) return -1;
      let result=value;
      for(let i=0;i<10;i++){if(i===2)continue;result=result+i;}
      if(result > 100) return 100;
      return result;
    }`;
    async function parity(native, paths) {
      const prepared = tc.prepareJavascriptApplication(tc.resolveProject({ cwd, profile: 'js' }));
      for (const input of paths) {
        const request = { method: 'GET', path: '/', url: 'https://test/', headers: { 'x-value': input } };
        const nr = await tc.executeCanonicalNativeModule(native, { request });
        const jr = await tc.executeNodeJavascriptApplication(prepared.loaded.application, new Request(request.url, { headers: request.headers }), { strict: false });
        assert.equal(nr.response.status, jr.status);
        assert.equal(nr.response.body, await jr.text());
      }
    }
    const cells = [];
    let tamperPlan;
    for (const count of [1, 2, 16]) {
      const calls = Array.from({length:count}, (_, i) => `const value${i}=isPositive(value+${i});`).join('');
      const body = `const value=+(ctx.req.header('x-value') || '0');${calls}return ctx.text(${Array.from({length:count},(_,i)=>`''+value${i}`).join("+'|'+")});`;
      const { plan, compiled } = compile(substantial, body);
      validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
      assert.equal(plan.helpers.length, 1);
      assert.equal(plan.effects.length, 0);
      assert.equal(plan.continuations.length, 0);
      assert.equal((compiled.generatedSource.match(/function __pulse_helper_0\(/g) || []).length, 1);
      const native = compileCanonicalNativePlan(plan, { cwd: root, emitWat: false });
      assert.equal((native.source.match(/function __pulse_pure_helper_0\(/g) || []).length, 1);
      await parity(native, ['-5', '0', '10', '200']);
      cells.push({ count, canonicalBodies: plan.helpers.length, generatedBodies: 1, wasmBytes: native.wasm.length });
      tamperPlan = plan;
    }
    for (const imported of [true, false]) {
      const { plan } = compile(scalar, `const n=+(ctx.req.header('x-value') || '0');const valid=isPositive(n);if(!isPositive(n))return ctx.text('no');return ctx.text(''+valid);`, imported);
      const native = compileCanonicalNativePlan(plan, { cwd: root, emitWat: false });
      await parity(native, ['-1', '0', '1']);
    }
    // Mutations in caller arguments expose repeated/reordered evaluation; pure
    // callee parameters remain immutable and each invocation resets its locals.
    const ordered = `export function isPositive(a:number,b:number):number {return a*10+b;}`;
    const {plan: orderPlan} = compile(ordered, `let n=0;const a=isPositive(n++,n++);const b=false&&isPositive(n++,n++);const c=true||isPositive(n++,n++);const d=false?isPositive(n++,n++):9;const e=isPositive(n++,n++);return ctx.text(''+a+'|'+e+'|'+n+'|'+d);`);
    const orderNative = compileCanonicalNativePlan(orderPlan, { cwd: root, emitWat: false });
    const orderResult = await tc.executeCanonicalNativeModule(orderNative, { request: {method:'GET',path:'/',url:'https://test/'} });
    assert.equal(orderResult.response.body, '1|23|4|9');
    await parity(orderNative, ['0', '1']);
    // Scalar string/boolean parameters and results are retained, too.
    const strings = compile(`export function isPositive(s:string,b:boolean):string {if(b)return s+'!';return s+'?';}`,
      `const value=ctx.req.header('x-value')||'';const a=isPositive(value,value==='yes');return ctx.text(a);`);
    await parity(compileCanonicalNativePlan(strings.plan,{cwd:root,emitWat:false}), ['yes','no','']);

    // String elements in pure bodies use the existing UTF-16 value operation,
    // including out-of-range reads. Test a real surrogate-pair predicate rather
    // than only admission, and independently reject forged serialized types.
    const indexed = compile(`export function isPositive(s:string,index:number):boolean {
      const ch=s[index];
      return ch>='\\ud800' && ch<='\\udbff' && s[index+1]>='\\udc00' && s[index+1]<='\\udfff';
    }`, `const value='a😀b';const index=+(ctx.req.header('x-value')||'0');return ctx.text(''+isPositive(value,index));`);
    const indexedNative=compileCanonicalNativePlan(indexed.plan,{cwd:root,emitWat:false});
    await parity(indexedNative, ['-1','0','1','2','3','4','1.5','NaN']);
    const findElement=value=>{
      if(!value||typeof value!=='object')return;
      if(value.kind==='element')return value;
      for(const child of Object.values(value)){const found=findElement(child);if(found)return found;}
    };
    for(const mutate of [
      e=>{e.index={kind:'literal',value:'0',valueKind:'number'};},
      e=>{e.object={kind:'literal',value:true,valueKind:'string'};},
      e=>{e.valueKind='number';}
    ]){
      const forged=structuredClone(indexed.plan);mutate(findElement(forged.helpers[0].body));
      delete forged.planHash;forged.planHash=createHash('sha256').update(stableStringify(forged)).digest('hex');
      assert.throws(()=>validateCanonicalNativePlan(forged));
    }

    // A checked immutable scalar snapshot is independent of its source record.
    const guardedSource = `export function isPositive(value:string):number {return value.length;}`;
    const guardedBody = `const raw=await ctx.req.json();const input={name:raw.name};const value=input.name;if(typeof value==='string'){input.name=17;return ctx.text(''+isPositive(value));}return ctx.text('invalid');`;
    const guarded = compile(guardedSource, guardedBody, true, 'post');
    const guardedNative = compileCanonicalNativePlan(guarded.plan,{cwd:root,emitWat:false});
    const guardedJs=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'js'}));
    for(const value of ['', 'abc', '😀', 17, false, null, [], {}]){
      const body=JSON.stringify({name:value});
      const request={method:'POST',path:'/',url:'https://test/',headers:{'content-type':'application/json'},body};
      const nr=await tc.executeCanonicalNativeModule(guardedNative,{request});
      const jsRequest=new Request(request.url,{method:'POST',headers:request.headers,body});
      const jr=await tc.executeNodeJavascriptApplication(guardedJs.loaded.application,jsRequest,{strict:false});
      const expected=typeof value==='string'?String(value.length):'invalid';
      assert.equal(nr.response.body,expected);assert.equal(await jr.text(),expected);
    }
    for(const body of [
      guardedBody.replace("typeof value==='string'",'true'),
      guardedBody.replace("typeof value==='string'","typeof value!=='string'"),
      guardedBody.replace('const value=', 'let value='),
      guardedBody.replace("input.name=17;", "value=17;")
    ])assert.throws(()=>compile(guardedSource,body));
    const findGuard=value=>{
      if(!value||typeof value!=='object')return;
      if(value.kind==='if' && value.test?.left?.operator==='typeof')return value;
      for(const child of Object.values(value)){const found=findGuard(child);if(found)return found;}
    };
    for(const mutate of [
      p=>{findGuard(p.handlers).test={kind:'literal',value:true,valueKind:'boolean'};},
      p=>{findGuard(p.handlers).test.operator='!==';},
      p=>{findGuard(p.handlers).test.right.value='number';},
      p=>{const guard=findGuard(p.handlers);[guard.then,guard.else]=[guard.else,guard.then];},
      p=>{const id=findGuard(p.handlers).test.left.value.id;p.locals.find(l=>l.id===id).declaration='let';}
    ]){
      const forged=structuredClone(guarded.plan);mutate(forged);
      delete forged.planHash;forged.planHash=createHash('sha256').update(stableStringify(forged)).digest('hex');
      assert.throws(()=>validateCanonicalNativePlan(forged));
    }

    const effectfulCaller = compile(`export function isPositive(s:string):boolean {return s==='body';}`,
      `const text=await ctx.fetch('https://effect.test').text();const result=isPositive(text);return ctx.text(''+result);`);
    let effectCount=0;
    const afterEffect=await tc.executeCanonicalNativeModule(compileCanonicalNativePlan(effectfulCaller.plan,{cwd:root,emitWat:false}),
      {request:{method:'GET',path:'/',url:'https://test/'},providerAdapter:{id:'pf02-read',dispatchEffect(){effectCount++;return {status:200,headers:{},body:'body'};}}});
    assert.equal(afterEffect.response.body,'true');assert.equal(effectCount,1);
    const reject = (source, body, code) => assert.throws(() => compile(source, body), error => {
      assert.ok(error.diagnostics?.some(d => d.code === code), JSON.stringify(error.diagnostics)); return true;
    }, code);
    const normal = `const value=isPositive(1);return ctx.text(''+value);`;
    const negatives = [
      [scalar.replace('value > 0','outside > 0'), normal, 'PULSE_NATIVE_PURE_HELPER_CAPTURE_UNSUPPORTED'],
      [scalar.replace('return value > 0','value++;return value > 0'), normal, 'PULSE_NATIVE_PURE_HELPER_MUTATION_UNSUPPORTED'],
      [scalar.replace('return value > 0','return isPositive(value)'), normal, 'PULSE_NATIVE_PURE_HELPER_CALL_UNSUPPORTED'],
      [scalar.replace('return value > 0',"ctx.text('x');return true"), normal, 'PULSE_NATIVE_PURE_HELPER_CALL_UNSUPPORTED'],
      [scalar.replace('return value > 0','return callback(value)'), normal, 'PULSE_NATIVE_PURE_HELPER_CALL_UNSUPPORTED'],
      [scalar.replace('return value > 0','return value.trim()'), normal, 'PULSE_NATIVE_PURE_HELPER_CALL_UNSUPPORTED'],
      [scalar.replace('return value > 0',"throw 'bad'"), normal, 'PULSE_NATIVE_PURE_HELPER_CONTROL_UNSUPPORTED'],
      [scalar.replace('value:number','value:{x?:number}'), normal, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
      [scalar.replace('value:number','value:(n:number)=>boolean'), normal, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
      [scalar.replace('function isPositive','async function isPositive'), normal, 'PULSE_NATIVE_HELPER_CALL_UNSUPPORTED'],
      [scalar.replace('value:number','value:number=1'), normal, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
      [scalar.replace('function isPositive','function* isPositive'), normal, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
      [scalar.replace('function isPositive(value:number):boolean', 'const isPositive=(value:number):boolean =>'), normal, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
      [scalar, normal.replace('isPositive(1)', "isPositive('x')"), 'PULSE_NATIVE_PURE_HELPER_ARGUMENT_UNSUPPORTED'],
      [scalar, normal.replace('isPositive(1)', 'isPositive(isPositive(1))'), 'PULSE_NATIVE_PURE_HELPER_NESTING_UNSUPPORTED'],
      [scalar, `for(let i=0;i<2 && isPositive(i);i++){}return ctx.text('x');`, 'PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED'],
      [scalar, `const isPositive=(n:number)=>false;${normal}`, 'PULSE_NATIVE_PURE_HELPER_CALL_UNSUPPORTED'],
    ];
    for (const args of negatives) reject(...args);
    // These reach independent plan proof: result mismatch, fallthrough and
    // mutation of a local's scalar kind cannot be hidden behind a signature.
    for (const source of [scalar.replace('return value > 0', 'if(value>0)return true'), scalar.replace('return value > 0', "return 'bad'"),
      scalar.replace('return value > 0', "let x=1;x='bad';return true")]) {
      assert.throws(() => compile(source, normal));
    }
    assert.throws(() => compile(scalar, `let n=1;n='wrong';const a=isPositive(n);return ctx.text(''+a);`),
      e => e.diagnostics?.some(d => d.code === 'PULSE_CANONICAL_NATIVE_PLAN_INVALID'));
    function findCall(value) {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'pure-helper-call') return value;
      for (const child of Object.values(value)) { const found=findCall(child); if(found)return found; }
    }
    assert.throws(() => compile(scalar, `const f=isPositive;const a=f(1);return ctx.text(''+a);`),
      e => e.diagnostics?.some(d => d.code === 'PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED'));
    const mutations = [
      p=>{p.version='pulse.canonical-native-plan.v5';},
      p=>{p.helpers[0].version='unknown';},
      p=>{p.helpers[0].frame.suspension='retain';},
      p=>{p.helpers[0].parameters[0].valueKind='object';},
      p=>{p.helpers[0].parameters[0].localId=p.handlers[0].localIds[0];},
      p=>{p.helpers[0].localIds.pop();},
      p=>{p.helpers[0].body.pop();},
      p=>{p.helpers[0].resultKind='string';},
      p=>{findCall(p.handlers).helperId='helper:foreign';},
      p=>{findCall(p.handlers).arguments=[];},
      p=>{findCall(p.handlers).arguments[0]={kind:'literal',value:'wrong',valueKind:'number'};},
      p=>{findCall(p.handlers).arguments[0]={kind:'intrinsic',name:'response.text',arguments:[],valueKind:'number'};},
      p=>{const h=p.helpers[0];p.locals.find(l=>l.id===h.parameters[0].localId).declaration='let';},
      p=>{const h=p.helpers[0];h.body.unshift({kind:'expression',expression:{kind:'assignment',operator:'=',target:{kind:'local',id:h.parameters[0].localId,valueKind:'number'},value:{kind:'literal',value:5,valueKind:'number'},valueKind:'number'}});},
      p=>{findCall(p.handlers).valueKind='boolean';},
      p=>{p.helpers[0].body.push({kind:'expression',expression:{kind:'intrinsic',name:'state.set',arguments:[],valueKind:'string'}});},
      p=>{p.helpers[0].body.push({kind:'expression',expression:structuredClone(findCall(p.handlers))});},
      p=>{p.helpers.push(structuredClone(p.helpers[0]));},
      p=>{p.helpers[0].body.find(s=>s.kind==='pure-loop').maxIterations=65537;},
    ];
    for (const [i, mutate] of mutations.entries()) {
      const p=structuredClone(tamperPlan); mutate(p); delete p.planHash;
      p.planHash=createHash('sha256').update(stableStringify(p)).digest('hex');
      assert.throws(()=>validateCanonicalNativePlan(p), e=>e.name==='CanonicalNativePlanError', `tamper ${i}`);
    }
    console.log(JSON.stringify({status:'passed',cells,sourceRejections:negatives.length+5,planRejections:mutations.length,
      scope:'Source-tree scalar proof; no packed consumer or final-Wasm sharing claim.'}));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error, error.diagnostics); process.exitCode = 1; });
