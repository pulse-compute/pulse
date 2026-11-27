'use strict';
const fs = require('node:fs');
const path = require('node:path');

const bearer = 'Bearer mac03-existing-user-token';
const bindings = { '/': 'REQUEST_PROOF_KEY', '/missing': 'MAC03_ABSENT_KEY', '/short': 'MAC03_SHORT_KEY', '/long': 'MAC03_LONG_KEY' };
const profiles = ['node-native', 'node-javascript', 'fastly-native', 'fastly-javascript'];
function write(root) {
  fs.mkdirSync(path.join(root, '.pulse'), { recursive: true });
  const routes = Object.entries(bindings).map(([route, binding]) => `app.post('${route}',async ctx=>{
 const before=ctx.req.header('authorization');
 const input=await ctx.req.json<{message:string}>();
 const tag=ctx.req.header('x-request-proof')||'';
 const proof=await crypto.verifyMacText(ctx,input.message,tag,{algorithm:'HS256',key:{type:'secret',binding:'${binding}'}});
 return ctx.json({status:proof.status,authorizationPreserved:before===ctx.req.header('authorization'),existingBearer:before==='${bearer}'});
});`).join('\n');
  fs.writeFileSync(path.join(root, 'app.ts'), `import {Pulse} from '@pulse-compute/pulse';import {crypto} from '@pulse-compute/crypto';
const app=new Pulse({auto:true});\n${routes}\nexport default app;\n`);
  const config = { pulse: { entry: 'app.ts', defaultProfile: 'fastly-native', strict: false, crypto: ['HS256'] } };
  for (const profile of profiles) {
    const [host, target] = profile.split('-');
    config[profile] = { host, target, outDir: `out/${profile}`, schemas: { maxBytes: 1048576 },
      ...(host === 'fastly' ? { fastly: { ...(target === 'native' ? { maxDurationMs: 1000 } : {}), bindings: { secretStore: 'app_secrets' }, build: { name: 'mac03-proof' } } } : {}) };
  }
  fs.writeFileSync(path.join(root, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));\n`);
}
module.exports = { write, bearer, bindings, profiles };
