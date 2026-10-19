#!/usr/bin/env node
'use strict';
// Diagnostic evidence only. Expected rejection is not feature acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { resolveProject } = require(path.join(root, 'wasm/packages/cli/src/project-config.js'));
const { compileProject, compileNativeProjectInMemory } = require(path.join(root, 'wasm/packages/cli/src/project-execution.js'));
const { executeCanonicalNativeModule } = require(path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host.js'));
const { createResourceManifest } = require(path.join(root, 'wasm/packages/contracts/src/resources/embedded.js'));
const output = process.argv[2] && path.resolve(process.argv[2]);
const scratch = path.join(root, 'wasm/.test-results');
fs.mkdirSync(scratch, { recursive: true });
const temp = fs.mkdtempSync(path.join(scratch, 'mcp05-readiness-'));
const budgets = { files: 1, fileBytes: 32, totalBytes: 32, serializedBytes: 2048, bindings: 1 };
const resource = JSON.stringify(createResourceManifest([{ path: '/data', bytes: Buffer.from('ABCD') }], budgets));
const variants = [
  ['scalar-control', 'return { value: input.value + 1 }', true],
  ['schema-encode', "const text = ctx.encodeJson({ value: input.value }, 'proof.Result'); return { text }", false],
  ['schema-decode', "const value = ctx.decodeJson('{\"value\":7}', 'proof.Result'); return value", false],
  ['resource-read', "const data = ctx.resources.map('data'); return { value: data.readU8(0) }", false],
  ['resource-utf8', "const data = ctx.resources.map('data'); const text = data.readUtf8(0, 4); return { text }", false],
  ['numeric-workspace', 'const cells = ctx.workspace.numbers(4); cells[0] = input.value; return { value: cells[0] }', false],
  ['bounded-loop', 'let value = 0; for (let i = 0; i < 4; i++) { value += i; } return { value }', false],
];
function write(file, text) { fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.writeFileSync(path.join(temp, file), text); }
function diagnostics(error) { return [...new Set((error.diagnostics || error.error?.diagnostics || []).map(d => d.code))].sort(); }
async function main() {
  const modules = path.join(temp, 'node_modules/@pulse-compute'); fs.mkdirSync(modules, { recursive: true });
  for (const name of ['pulse','runtime','entities','mcp','provider-node','provider-fastly']) fs.symlinkSync(path.join(root, 'packages', name), path.join(modules, name), 'dir');
  write('package.json', '{"private":true,"type":"module"}');
  write('src/schemas.ts', "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'; interface Result { value: number }; interface Text { text: string }; export default defineSchemaRegistry({schemas:{'proof.Result':schema<Result>(),'proof.Text':schema<Text>()}});");
  write('.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify({ pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', tests: null, strict: true, defaultProfile: 'node-native', binaryResources: { manifest: resource, bindings: { data: '/data' }, budgets } }, 'node-native': { host: 'node', target: 'native' }, 'node-javascript': { host: 'node', target: 'javascript' }, 'fastly-native': { host: 'fastly', target: 'native', fastly: { maxDurationMs: 5000 } } })}));`);
  const results = [];
  for (const [name, body, expected] of variants) {
    write('src/handlers.ts', `export function operation(ctx, input) { ${body} }`);
    const schema = name === 'schema-encode' || name === 'resource-utf8' ? 'proof.Text' : 'proof.Result';
    const source = `import {EntityRouter,jsonRpc,mcp} from '@pulse-compute/mcp/pulse'; import {operation} from './handlers.js'; const rpc = new EntityRouter({adapter:jsonRpc({namedParamsOnly:true})}); rpc.on('proof.run',{input:'proof.Result',output:'${schema}'},operation); const server=mcp({router:rpc}); export default async function handler(ctx) { return server.handle(ctx); }`;
    write('src/index.ts', source);
    const row = { name, sourceSha256: crypto.createHash('sha256').update(body).digest('hex'), targets: {} };
    for (const profile of ['node-native','fastly-native','node-javascript']) {
      try { const compiled = compileProject(resolveProject({cwd:temp,profile})); row.targets[profile] = { status: 'accepted', nativeEligibility: compiled.compiler?.packageInspection?.managedHandlers?.summary || null }; }
      catch(error) { row.targets[profile] = { status: 'rejected', code: error.code, diagnostics: diagnostics(error) }; }
    }
    assert.equal(row.targets['node-native'].status, expected ? 'accepted' : 'rejected', name);
    assert.equal(row.targets['fastly-native'].status, expected ? 'accepted' : 'rejected', name);
    assert.equal(row.targets['node-javascript'].status, 'accepted', name);
    results.push(row);
  }
  // The same primitives together work in the ordinary Native handler contract.
  write('src/index.ts', `export default async function handler(ctx) {
    const data=ctx.resources.map('data');
    const word=data.readUtf8(0,4);
    if(word!=='ABCD') return ctx.text('wrong UTF-8');
    const cells=ctx.workspace.numbers(4);
    let sum=0; for(let i=0;i<4;i++){ cells[i]=data.readU8(i); sum+=cells[i]; }
    const decoded=ctx.decodeJson('{"value":7}','proof.Result');
    return ctx.text(ctx.encodeJson({value:sum+decoded.value},'proof.Result'));
  }`);
  const native = compileNativeProjectInMemory(resolveProject({ cwd: temp, profile: 'node-native' }), { emitWat: false, reportCapture: false });
  const execution = await executeCanonicalNativeModule(native.native, {});
  assert.equal(execution.status, 'completed'); assert.deepEqual(JSON.parse(execution.response.body), { value: 273 });
  const report = { schemaVersion: 'pulse.b10-mcp-05-readiness.v1', status: 'reproduced-blocker', featureComplete: false,
    source: { head: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), tree: execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(), workingTree: execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean) },
    node: process.version, results, ordinaryNativeControl: { status: execution.status, body: execution.response.body, wasmSha256: crypto.createHash('sha256').update(native.native.wasm).digest('hex') } };
  if (output) fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
