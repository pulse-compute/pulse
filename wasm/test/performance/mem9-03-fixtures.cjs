'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createECDH } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const cases = ['numeric', 'flat-loop-cap', 'unknown', 'strings', 'overwrite-object', 'snapshots', 'pure-helper', 'shared-stage', 'stub', 'linked', 'read-loop'];
const sizes = [0, 64, 512];

// Public, deterministic TEST key: scalar 1, never a credential.
function testKey() {
  const d = Buffer.alloc(32); d[31] = 1;
  const ec = createECDH('prime256v1'); ec.setPrivateKey(d);
  const p = ec.getPublicKey();
  return JSON.stringify({ kty: 'EC', crv: 'P-256', d: d.toString('base64url'), x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') });
}
function fixture(id, n, cwd) {
  if (!cases.includes(id) || !sizes.includes(n)) throw new Error('Unknown MEM9-03 cell');
  const loop = `let n=70000;for(let i=0;i<${n};i++){n+=1;}`;
  let body = loop + "return ctx.text(''+n);";
  let extra = '', imports = '';
  // MEM9-02 admits each pure-loop cap only through 256. Equal additions with
  // two eligible loop caps distinguish that control from the flat-loop residual.
  if (id === 'numeric') body = `let n=70000;for(let i=0;i<${n / 8};i++){for(let j=0;j<8;j++){n+=1;}}return ctx.text(''+n);`;
  if (id === 'unknown') body = `let n=input.n;for(let i=0;i<${n};i++){n+=1;}return ctx.text(''+n);`;
  if (id === 'strings') body = `let n=70000;let text='70000';for(let i=0;i<${n};i++){n+=1;text=''+n;}return ctx.text(text);`;
  if (id === 'overwrite-object') body = `const state={n:70000};for(let i=0;i<${n};i++){state.n+=1;}return ctx.text(''+state.n);`;
  if (id === 'snapshots') body = `let n=70000;const saved=[];for(let i=0;i<${n};i++){saved[i]=n;n+=1;}return ctx.json(saved);`;
  if (id === 'pure-helper') {
    imports = "import {sum} from './helper';";
    extra = `export function sum():number {${loop}return n;}`;
    body = "const n=sum();return ctx.text(''+n);";
  }
  if (id === 'linked') {
    imports = "import {jwt} from '@pulse-compute/jwt';";
    body = `const token=await jwt.sign(ctx,{sub:'mem9-test'},{algorithm:'ES256',key:{type:'secret',binding:'TEST_KEY'},expiresInSeconds:60});${body}`;
  }
  if (id === 'read-loop') body = `let n=70000;for(let r=0;r<1;r++){const row=await ctx.kv('pages').getVersioned('p');for(let i=0;i<${n};i++){n+=1;}}return ctx.text(''+n);`;
  const schema = !['stub', 'linked'].includes(id);
  const read = schema ? "const input=await ctx.req.json('proof.Input');" : '';
  let registration = `app.post('/',async ctx=>{${read}${body}});`;
  if (id === 'shared-stage') {
    imports = "import shared from './helper';";
    extra = `export default async function shared(ctx,next){const text=await ctx.fetch('https://mem9-origin.test/value').text();${loop}ctx.state.set('sum',''+n);return next();}`;
    registration = `app.use(shared);app.post('/other',shared);app.post('/',async ctx=>{${read}return ctx.text(ctx.state.get('sum'));});`;
  }
  const source = `import {Pulse} from '@pulse-compute/pulse';${imports}\nconst app=new Pulse({auto:true});${registration}export default app;\n`;
  const config = { pulse: { entry: 'src/index.ts', strict: false, ...(schema ? { schema: 'src/schemas.ts' } : {}), ...(id === 'linked' ? { crypto: ['ES256'] } : {}) }, node: { host: 'node', target: 'native' }, fastly: { host: 'fastly', target: 'native', fastly: { bindings: { secretStore: 'app_secrets', kv: { pages: 'pages' }, backends: { 'https://mem9-origin.test': 'fixture_origin' } } } } };
  const files = {
    'src/index.ts': source,
    'src/helper.ts': extra,
    'src/types.ts': 'export interface Input {n:number}\n',
    'src/schemas.ts': "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {Input} from './types';export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>()}});\n",
    '.pulse/config.ts': `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));\n`,
  };
  for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); fs.writeFileSync(path.join(cwd, name), text); }
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  for (const name of ['pulse', 'jwt']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  return {
    files, expected: id === 'snapshots' ? JSON.stringify(Array.from({ length: n }, (_, i) => 70000 + i)) : String(70000 + n),
    liveData: id === 'snapshots' ? 'N numeric snapshots, deliberately live through response construction' : 'constant-size working state; no per-iteration history is semantically retained',
    request: { method: 'POST', path: '/', url: 'https://mem9.test/', headers: [['content-type', 'application/json']], body: '{"n":70000}' },
    secrets: { TEST_KEY: testKey() },
  };
}
module.exports = { cases, sizes, fixture };
