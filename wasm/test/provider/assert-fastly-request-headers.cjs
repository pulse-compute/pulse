'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');

function main(packedRoot) {
  const root = packedRoot || path.resolve(__dirname, '../../..');
  const tc = acceptanceToolchain(packedRoot);
  const dir = fs.mkdtempSync(path.join(root, '.headers-proof-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, '.pulse'));
    fs.writeFileSync(path.join(dir, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(_ => ({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{bindings:{kv:{proof:'proof'}}}}}));`);
    function compile(errorHandler) {
      fs.writeFileSync(path.join(dir, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
const app = new Pulse({auto:true});
app.get('/headers', async ctx => {
  const headers = ctx.req.headers;
  const again = ctx.req.headers;
  let commands = 0;
  for (let i = 0; i < 256 && i < headers.length; i++) {
    if (headers[i][0] === 'idempotency-key') commands += 1;
  }
  if (commands > 1) return ctx.json({error:'duplicate-command'}, {status:400});
  await ctx.kv('proof').put('accepted', true);
  return ctx.json({headers, again});
});
app.get('/unused', async ctx => ctx.text('ok'));
${errorHandler ? "app.error(async (error, ctx, next) => ctx.text('application-error', {status:422}));" : ''}
export default app;`);
      return tc.compileFastly(tc.resolveProject({cwd:dir, profile:'proof'}));
    }
    let checks = 0;
    for (const applicationError of [false, true]) {
      const native = compile(applicationError);
      const run = (headers, options = {}) => tc.executeFastlyNativePlatformCapabilities(native, {
        request:{method:'GET',path:'/headers',headers},kvStores:{proof:{}},...options,
      });
      for (const headers of [[], [['X-One','first'], ['x-one','second'], ['x-empty','']], [['Authorization','private-token']]]) {
        for (const requestHeaderPageBytes of [65536, 16]) {
          const result = run(headers, {requestHeaderPageBytes});
          assert.equal(result.response.status, 200);
          const expected = headers.map(([k,v]) => [k.toLowerCase(),v]);
          assert.deepEqual(JSON.parse(result.response.body), {headers:expected, again:expected});
          assert.equal(result.trace.filter(x => x.name === 'header_names_get' && x.cursor === 0).length, 1, 'snapshot cached');
          assert.ok(!JSON.stringify(result.trace).includes('private-token'));
          checks++;
        }
      }
      const paged = run([['x','one'],['x','two'],['x','three']], {requestHeaderPageBytes:6});
      assert.deepEqual(JSON.parse(paged.response.body).headers, [['x','one'],['x','two'],['x','three']]);
      assert.equal(paged.trace.filter(x => x.name === 'header_values_get').length, 3);
      checks++;
      assert.throws(() => run([['x','one'],['x','two']], {
        requestHeaderPageBytes:4, requestHeaderFault: call => call.kind === 'values' && call.cursor > 0 ? {status:1} : undefined,
      }), error => {
        assert.equal(error.detail.errorStage,24);
        assert.ok(!error.detail.trace.some(x => x.module === 'fastly_kv_store' || x.name === 'send_downstream'));
        return true;
      }); checks++;
      assert.equal(run(Array.from({length:256},()=>['x','v'])).response.status,200);
      checks++;
      const emptyHost = run([], {requestHeaderFault:()=>({cursor:0})});
      assert.deepEqual(JSON.parse(emptyHost.response.body).headers, []);
      checks++;
      const duplicate = run([['Idempotency-Key','command-one'],['idempotency-key','command-two']]);
      assert.equal(duplicate.response.status, 400);
      assert.deepEqual(duplicate.stores.kv.proof, {});
      assert.ok(!duplicate.trace.some(x => x.module === 'fastly_kv_store'));
      checks++;
      const unused = run([], {request:{method:'GET',path:'/unused'}, requestHeaderFault:()=>({status:1})});
      assert.equal(unused.response.status,200);
      assert.ok(!unused.trace.some(x => /header_(names|values)_get/.test(x.name)));
      checks++;
      for (const kind of ['names','values']) {
        for (const fault of [{status:1},{status:4},{written:65537},{written:-1},{cursor:0},{cursor:-2},{cursor:4294967296},{cursor:1,written:0},{unterminated:true}]) {
          assert.throws(() => run([['x-one','value']], {requestHeaderFault: call => call.kind === kind ? fault : undefined}), error => {
            assert.equal(error.detail.lastError,1003);
            assert.equal(error.detail.errorStage,24);
            assert.ok(!error.detail.trace.some(x => x.module === 'fastly_kv_store' || x.name === 'send_downstream'), 'failed snapshot cannot reach storage or response');
            return true;
          }); checks++;
        }
      }
      for (const headers of [Array.from({length:257},(_,i)=>['x-'+i,'v']), Array.from({length:257},()=>['x','v']), [['x','v'.repeat(65534)]]]) {
        assert.throws(() => run(headers), error => {
          assert.equal(error.detail.errorStage,24);
          assert.ok(!error.detail.trace.some(x => x.module === 'fastly_kv_store' || x.name === 'send_downstream'));
          return true;
        }); checks++;
      }
      const boundary = run([['x','v'.repeat(65533)]]);
      assert.equal(boundary.response.status,200);
      checks++;
    }
    console.log(`ok - Fastly Native request headers: ${checks} compiled checks (${packedRoot ? 'installed packages' : 'workspace'})`);
    return {checks};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
if (require.main === module) {
  const execute = process.argv[2] === '--execute';
  const [packedRoot, pack] = process.argv.slice(execute ? 3 : 2);
  if (packedRoot && !execute) {
    assert.ok(pack, 'Packed mode requires both the isolated install and release-pack directory');
    const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'pulse-release-manifest.json')));
    const {verifyClosure} = require('../release/assert-request-deadline-packages.cjs');
    verifyClosure(packedRoot, pack, manifest);
    const child = require('node:child_process').spawnSync(process.execPath, [__filename, '--execute', packedRoot], {
      cwd:packedRoot, env:process.env, encoding:'utf8', timeout:180000,
    });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    verifyClosure(packedRoot, pack, manifest);
    process.stdout.write(child.stdout);
    console.log(`ok - ${manifest.packageCount} exact packages verified before and after execution`);
  } else {
    main(packedRoot);
    if (packedRoot) {
      const repo = path.resolve(__dirname, '../../..');
      const fixtures = ['native-platform-capabilities-host.js', 'conditional-kv-host.js']
        .map(file => path.join(repo, 'packages/provider-fastly/src/testing', file));
      for (const file of Object.keys(require.cache)) {
        if (file.startsWith(path.join(repo, 'packages') + path.sep) || file.startsWith(path.join(repo, 'wasm/packages') + path.sep))
          assert.ok(fixtures.includes(file), `Workspace product module loaded: ${file}`);
      }
      console.log('ok - zero workspace product modules loaded');
    }
  }
}
module.exports = {main};
