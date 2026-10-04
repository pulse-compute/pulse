'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { acceptanceToolchain } = require('./acceptance-toolchain.cjs');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const root = path.resolve(__dirname, '../../..');
const cwd = fs.mkdtempSync(path.join(__dirname, '.text-state-'));
try {
  fs.mkdirSync(path.join(cwd, '.pulse'));
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  for (const name of ['pulse', 's3', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  const config = { pulse: { entry: 'index.ts', defaultProfile: 'native', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] },
    native: { host: 'node', target: 'native', node: require('./o1/bindings.json').node } };
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import { defineConfig } from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}));`);
  const tc = acceptanceToolchain();
  const plan = (body, declaration = 'const', operation = 'getText') => {
    fs.writeFileSync(path.join(cwd, 'index.ts'), `import { Pulse } from '@pulse-compute/pulse'; import { s3 } from '@pulse-compute/s3'; import { crypto } from '@pulse-compute/crypto';
      const app = new Pulse({auto:true}); app.post('/', async ctx => {
        ${declaration} result = await s3.${operation}(ctx, 'objects', 'key'); ${body} return ctx.text('ok');
      }); export default app;`);
    return buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({ cwd }), { target: 'native' }));
  };
  const write = "ctx.state.set('saved', result.text);";
  const suspend = "const hash = await crypto.digestText(ctx, result.text); if(hash.status !== 'ok') return ctx.text('failed');";
  for (const body of [
    `if(result.status === 'found') { ${write} }`,
    `if('found' === result.status) { ${write} }`,
    `if(result.status !== 'found') return ctx.text('missing'); ${suspend} ${write}`,
    `if(result.status !== 'found' || result.byteLength > 10) return ctx.text('missing'); ${suspend} ${write}`,
    `if(result.status === 'found' && result.byteLength < 10) { ${write} }`,
    `if(!(result.status !== 'found')) { ${write} }`,
    `if(result.status === 'found') { if(result.byteLength > 10) return ctx.text('large'); ${suspend} ${write} }`,
  ]) {
    const first = plan(body);
    assert.equal(first.planHash, plan(body).planHash, 'guarded text plans are deterministic');
    assert.match(JSON.stringify(first), /"property":"text","valueKind":"string"/);
  }
  for (const [body, declaration, operation] of [
    [write],
    [`if(result.status !== 'found') { ${write} }`],
    [`if(result.status === 'found') { ${write} } ${write}`],
    [`if(result.status === 'found' || result.byteLength < 10) { ${write} }`],
    [`if(result.status !== 'found' && result.byteLength > 10) return ctx.text('missing'); ${write}`],
    [`if(result.status !== 'found') return ctx.text('missing'); ${write}`, 'let'],
    [`if(result.status !== 'found') return ctx.text('missing'); ${write}`, 'const', 'head'],
    [`if(result.status !== 'found') return ctx.text('missing'); result.text = 1; ${write}`],
    [`if(result.status !== 'found') return ctx.text('missing'); const alias = result; alias.text = 1; ${write}`],
    [`if(result.status !== 'found') return ctx.text('missing'); if(result.byteLength > 0) result.text = 1; ${write}`],
    [`if(result.status !== 'found') return ctx.text('missing'); for(let i=0;i<2;i++){ result.text = 1; } ${write}`],
  ]) assert.throws(() => plan(body, declaration, operation), error =>
    error.diagnostics?.some(d => d.code === 'PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED' && d.message === 'state.set requires a string value.'));
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
console.log('ok - guarded S3 text state planning, suspension, scope and mutation negatives');
