'use strict';
// Characterizes existing resolution only. Does not admit or execute ctx.call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const { buildReachableProjectGraph } = require(path.join(root, 'wasm/packages/compiler/src/project/reachable-graph-builder'));
const { linkProjectRouterModules } = require(path.join(root, 'wasm/packages/compiler/src/project/router-module-linker'));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-call-linker-'));
const cases = [];
function link(imports, body) {
  fs.writeFileSync(path.join(cwd, 'index.ts'), `import {Pulse} from '@pulse-compute/pulse';\n${imports}\nconst app=new Pulse({auto:true});app.get('/',async(ctx)=>{${body};return ctx.text('ok');});export default app;`);
  return linkProjectRouterModules(buildReachableProjectGraph(path.join(cwd, 'index.ts'), { rootDir:cwd, workspaceRoot:root, target:'native' }), {target:'native'});
}
try {
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), {recursive:true});
  for (const name of ['pulse','runtime']) fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  fs.writeFileSync(path.join(cwd,'target.ts'),'export function lookup(ctx,input){return input.value;}');
  fs.writeFileSync(path.join(cwd,'barrel.ts'),"export {lookup as search} from './target';");
  for (const [name,imports,body] of [
    ['named import',"import {lookup} from './target';",'const value=lookup(ctx,{value:1})'],
    ['import alias',"import {lookup as query} from './target';",'const value=query(ctx,{value:1})'],
    ['named re-export',"import {search} from './barrel';",'const value=search(ctx,{value:1})'],
    ['same target through two aliases',"import {lookup as first,lookup as second} from './target';",'const a=first(ctx,{value:1});const b=second(ctx,{value:2})']
  ]) {
    const linked=link(imports,body);
    assert.equal(linked.sourceHelpers.length,1);
    const target=linked.sourceHelpers[0];
    assert.deepEqual(target.source,{file:'target.ts',name:'lookup'});
    cases.push({name,status:'passed',resolvedTarget:target.source});
  }
  let rejected=false;
  try { link("import {lookup} from './target';", "const value=ctx.call(lookup,{value:1},{inputSchema:'proof.Input',outputSchema:'proof.Output'})"); }
  catch(error) {
    assert.ok(error.diagnostics?.some(d=>d.code==='PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED'),JSON.stringify(error.diagnostics));
    cases.push({name:'ctx.call target is not consumed by existing linker',status:'expected-rejection',diagnostics:error.diagnostics.map(d=>d.code)});
    rejected=true;
  }
  assert.ok(rejected,'Unexpected authoring admission; re-evaluate this checkpoint');
  const result={version:'pulse.call-linker-characterization.v1',status:'passed',publicCallSyntax:false,runtimeExecution:false,cases};
  if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result)+'\n');
} finally { fs.rmSync(cwd,{recursive:true,force:true}); }
