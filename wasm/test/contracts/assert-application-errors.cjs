#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { PACKAGE_SET, RELEASE_VERSION } = require('../../../scripts/package-support.cjs');

const repoRoot = path.resolve(__dirname, '../../..');
// Optional fresh installed-package root replays these same public consumer cases.
const installedRoot = process.argv[2];
const root = installedRoot ? path.resolve(installedRoot)
  : fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'application-errors-'));
function write(relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
if (!installedRoot) {
  write('package.json', JSON.stringify({ name: 'application-errors-parity-consumer', private: true,
    dependencies: Object.fromEntries(PACKAGE_SET.map(({ name }) => [name, RELEASE_VERSION])) }));
  fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
  for (const entry of PACKAGE_SET) fs.symlinkSync(path.join(repoRoot, entry.dir),
    path.join(root, 'node_modules', entry.name), process.platform === 'win32' ? 'junction' : 'dir');
}
const request = createRequire(path.join(root, 'package.json'));
const cli = path.resolve(path.dirname(request.resolve('@pulse-compute/cli')), '../bin/pulse.js');
function run(command, profile) {
  const result = spawnSync(process.execPath, [cli, command, '--profile', profile, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
async function main() {
  write('.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', tests: 'tests/pulse.harness.ts', strict: true, defaultProfile: 'javascript' },
  javascript: { host: 'node', target: 'javascript', outDir: 'dist/javascript', crypto: { HS256: { realization: 'runtime-builtin' } } },
  native: { host: 'node', target: 'native', outDir: 'dist/native', crypto: { HS256: { realization: 'guest-source:pulse-hmac-as' } } },
  fastly: { host: 'fastly', target: 'native', outDir: 'dist/fastly', crypto: { HS256: { realization: 'guest-source:pulse-hmac-as' } },
    fastly: { bindings: { secretStore: 'secrets', configStore: 'config', backends: { 'https://origin.test': 'origin' } } } },
  fastlyjs: { host: 'fastly', target: 'javascript', outDir: 'dist/fastlyjs', crypto: { HS256: { realization: 'runtime-builtin' } },
    fastly: { bindings: { backends: { 'https://origin.test': 'origin' } } } }
}));`);
  write('src/schemas.ts', `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';
export interface Input { id: string; version: number }
export default defineSchemaRegistry({ schemas: { 'app.Input': schema<Input>() } });`);
  write('src/index.ts', `import { Pulse } from '@pulse-compute/pulse';
import { Router } from '@pulse-compute/runtime';
import { jwt } from '@pulse-compute/jwt';
import type { Input } from './schemas.js';
const app = new Pulse({ auto: true });
const child = new Router();
child.post('/request', async (ctx) => {
  const input = await ctx.req.json<Input>('app.Input');
  return ctx.text(ctx.encodeJson(input, 'app.Input'));
});
child.get('/decode', async (ctx) => {
  const input = ctx.decodeJson<Input>(ctx.req.header('x-input'), 'app.Input');
  return ctx.text(ctx.encodeJson(input, 'app.Input'));
});
child.get('/encode', async (ctx) => {
  const encoded = ctx.encodeJson({ id: 'r1', version: 'wrong' }, 'app.Input');
  const forbidden = await ctx.config.get('MUST_NOT_RUN');
  return ctx.text(encoded + forbidden);
});
child.get('/response', async (ctx) => ctx.json({ id: 'r1', version: 'wrong' }, { schema: 'app.Input' }));
child.get('/jwt', async (ctx) => {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['HS256'], key: { type: 'secret', binding: 'JWT_KEY' }
  });
  return ctx.text(verified.claims.sub);
});
child.get('/fetch', async (ctx) => {
  const input = await ctx.fetch('https://origin.test/value').json<Input>('app.Input');
  const late = await ctx.config.get('MUST_NOT_RUN');
  return ctx.text(input.id + late);
});
child.get('/jwt-schema', async (ctx) => {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['HS256'], key: { type: 'secret', binding: 'JWT_KEY' }, claimsSchema: 'app.Input'
  });
  return ctx.text(verified.claims.id);
});
child.get('/group', async (ctx) => {
  const { input, sibling } = await ctx.parallel({
    input: ctx.fetch('https://origin.test/value').json<Input>('app.Input'),
    sibling: ctx.fetch('https://origin.test/sibling').text()
  });
  const late = await ctx.config.get('MUST_NOT_RUN');
  return ctx.text(input.id + sibling + late);
});
child.error(async (error, ctx, next) => {
  if (ctx.req.header('x-recover') === 'clear') return next();
  if (ctx.req.header('x-recover') === 'fail') {
    const value = ctx.decodeJson<Input>('bad json', 'app.Input');
    return ctx.text(value.id);
  }
  return next(error);
});
child.get('/decode', async (ctx) => ctx.text('recovered'));
app.mount('/api', child);
app.error(async (error, ctx, next) => {
  if (ctx.req.header('x-exhaust') === 'yes') return next(error);
  return ctx.text(error.code, { status: 400 });
});
export default app;`);
  const errorCase = (name, path, code, headers = {}, body) => ({ name,
    request: { method: body === undefined ? 'GET' : 'POST', path: '/api/' + path,
      headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body }) },
    expect: { status: 400, text: code }
  });
  const cases = [
    errorCase('request schema', 'request', 'PULSE_SCHEMA_DECODE', {}, '{"id":"r1","version":"wrong"}'),
    errorCase('request JSON', 'request', 'PULSE_SCHEMA_JSON_MALFORMED', {}, '{bad'),
    errorCase('text schema', 'decode', 'PULSE_SCHEMA_DECODE', { 'x-input': '{"id":"r1","version":"wrong"}' }),
    errorCase('text JSON', 'decode', 'PULSE_SCHEMA_JSON_MALFORMED', { 'x-input': 'bad' }),
    errorCase('encode before effect', 'encode', 'PULSE_SCHEMA_ENCODE'),
    errorCase('response encoding', 'response', 'PULSE_SCHEMA_ENCODE'),
    errorCase('JWT missing', 'jwt', 'PULSE_JWT_TOKEN_REQUIRED'),
    errorCase('JWT bearer', 'jwt', 'PULSE_JWT_BEARER_INVALID', { authorization: 'Basic invalid' }),
    errorCase('JWT malformed', 'jwt', 'PULSE_JWT_MALFORMED', { authorization: 'Bearer abc.def.ghi' }),
    errorCase('error handler fails forward', 'decode', 'PULSE_SCHEMA_JSON_MALFORMED', { 'x-input': '{}', 'x-recover': 'fail' }),
    { ...errorCase('clear error lane', 'decode', '', { 'x-input': '{}', 'x-recover': 'clear' }), expect: { status: 200, text: 'recovered' } },
    { ...errorCase('error exhaustion', 'decode', '', { 'x-input': '{}', 'x-exhaust': 'yes' }), expect: { status: 500, text: 'Internal Server Error' } },
    { ...errorCase('valid bytes', 'request', '', {}, '{"id":"雪","version":1,"drop":true}'), expect: { status: 200, text: '{"id":"雪","version":1}' } }
  ];
  const secret = 'application-error-fixture-secret-32-bytes';
  function token(claims, key = secret) {
    const input = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${input}.${crypto.createHmac('sha256', key).update(input).digest('base64url')}`;
  }
  cases.push(
    { ...errorCase('JWT signature', 'jwt', 'PULSE_JWT_SIGNATURE_INVALID', { authorization: 'Bearer ' + token({ sub: 'private-user' }, 'wrong-signing-key-at-least-32-bytes') }), secrets: { JWT_KEY: secret } },
    { ...errorCase('JWT claims', 'jwt', 'PULSE_JWT_CLAIMS_INVALID', { authorization: 'Bearer ' + token({ sub: 'private-user', exp: 1 }) }), secrets: { JWT_KEY: secret } },
    { ...errorCase('JWT claims schema', 'jwt-schema', 'PULSE_JWT_CLAIMS_SCHEMA_INVALID', { authorization: 'Bearer ' + token({ sub: 'private-user' }) }), secrets: { JWT_KEY: secret } },
    { ...errorCase('fetch schema', 'fetch', 'PULSE_SCHEMA_DECODE'), fetches: { 'https://origin.test/value': { body: '{"id":"r1","version":"wrong"}', headers: { 'content-type': 'application/json' } } } },
    { ...errorCase('grouped failure', 'group', 'PULSE_SCHEMA_DECODE'),
      fetches: { 'https://origin.test/value': { body: '{"id":"r1","version":"wrong"}', headers: { 'content-type': 'application/json' } }, 'https://origin.test/sibling': { body: 'sibling settled' } } }
  );
  write('tests/pulse.harness.ts', `export default ${JSON.stringify(cases)};`);
  for (const profile of ['javascript', 'native', 'fastly', 'fastlyjs']) {
    const result = run('test', profile);
    assert.deepEqual(result.summary, { total: cases.length, passed: cases.length, failed: 0 });
    console.log(`ok - ${profile}: schema/JWT errors, forward recovery, exhaustion and encoded bytes (local execution)`);
  }
  const built = run('build', 'javascript');
  const application = request(built.files.entry);
  const schemaCodecs = request(built.files.schemaCodecs);
  const { executeNodeJavascriptTestCase } = request('@pulse-compute/provider-node/javascript/test-runtime');
  for (const testCase of cases) {
    const result = await executeNodeJavascriptTestCase(application,
      { ...testCase, request: { ...testCase.request, headers: Object.entries(testCase.request.headers) } },
      { strict: true, schemaCodecs, networkFetch: false });
    assert.equal(result.response.status, testCase.expect.status);
    assert.equal(result.response.body, testCase.expect.text);
  }
  console.log('ok - built JavaScript consumer preserves application errors and encoded bytes');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (!installedRoot) fs.rmSync(root, { recursive: true, force: true });
});
