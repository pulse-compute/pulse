'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PACKAGE_SET } = require('../../../scripts/package-support.cjs');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root = path.resolve(__dirname, '../../..');

function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-schema-allocation-'));
  try {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const p of PACKAGE_SET) fs.symlinkSync(path.join(root, p.dir), path.join(cwd, 'node_modules', p.name), 'dir');
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false,crypto:['SHA-256']},fastly:{host:'fastly',target:'native',schemas:{maxBytes:1048576}}}));`);
    fs.writeFileSync(path.join(cwd, 'src/schemas.ts'), `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
export interface Row {text:string; total:number}
export interface Input {text:string}
export interface Result {rows:Row[]}
export default defineSchemaRegistry({schemas:{'app.Input':schema<Input>(),'app.Result':schema<Result>()}});`);
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
import {crypto} from '@pulse-compute/crypto';
import type {Input,Result} from './schemas.js';
const app=new Pulse({auto:true});
app.post('/encode',async ctx=>{
  const input=await ctx.req.json<Input>('app.Input');
  let total=70000;
  for(let i=0;i<256;i++){for(let j=0;j<256;j++){total+=1;total+=1;total+=1;total+=1;total+=1;total+=1;total+=1;total+=1;}}
  const first={text:input.text,total};
  const second={text:'independent',total:7};
  const value:Result={rows:[first,second]};
  const encoded=ctx.encodeJson(value,'app.Result');
  const digest=await crypto.digestText(ctx,encoded);
  return ctx.json({encoded,digest});
});export default app;`);
    const plan = buildCanonicalNativePlan(compileProject(resolveProject({ cwd, profile: 'fastly' })));
    const compiled = compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd, bindings: {}, canonicalBuild: true });
    let maxMemoryBytes = 0;
    for (const text of ['\u0001'.repeat(80000), '😀雪"\\\n'.repeat(8000)]) {
      const result = executeFastlyNativePlatformCapabilities(compiled, { request: {
        method: 'POST', path: '/encode', headers: [['content-type', 'application/json']], body: JSON.stringify({ text })
      } });
      const encoded = JSON.stringify({ rows: [{ text, total: 594288 }, { text: 'independent', total: 7 }] });
      assert.equal(result.response.status, 200);
      assert.deepEqual(JSON.parse(result.response.body), { encoded, digest: {
        status: 'ok', byteLength: Buffer.byteLength(encoded), sha256: createHash('sha256').update(encoded).digest('hex')
      } });
      maxMemoryBytes = Math.max(maxMemoryBytes, result.instance.exports.memory.buffer.byteLength);
      assert.throws(() => result.instance.exports.memory.grow(4097), RangeError);
    }
    assert.ok(maxMemoryBytes <= 128 * 1024 * 1024, `schema allocation used ${maxMemoryBytes} bytes`);
    console.log(`ok - scalar-heavy Fastly schema encoding preserves exact escaped bytes and independent collections; memory ${maxMemoryBytes}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
module.exports = { main };
if (require.main === module) main();
