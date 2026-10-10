'use strict';
// Deliberately small, frozen inputs: no live services, credentials or package lowerers.
const fixtures = [
  {
    id: 'minimal-request',
    source: `export default async function handler(ctx) { return ctx.json({ ok: true }); }\n`,
    cases: [{ request: { method: 'GET', path: '/' }, expected: { status: 200, json: { ok: true } } }],
  },
  {
    id: 'schema-effect',
    source: `import type { Input, Origin } from './schemas';
export default async function handler(ctx) {
  const input = await ctx.req.json<Input>('bench.Input');
  const origin = await ctx.fetch('https://origin.example.test/value').json<Origin>('bench.Origin');
  return ctx.json({ name: input.name, score: origin.score }, { schema: 'bench.Output' });
}\n`,
    schema: `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';
export interface Input { name: string }
export interface Origin { score: number }
export interface Output { name: string; score: number }
export default defineSchemaRegistry({ schemas: {
  'bench.Input': schema<Input>(), 'bench.Origin': schema<Origin>(), 'bench.Output': schema<Output>(),
} });\n`,
    fetches: { 'https://origin.example.test/value': { status: 200, value: { score: 7, ignored: true } } },
    cases: [{ request: { method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: '{"name":"Ada","ignored":true}' }, expected: { status: 200, json: { name: 'Ada', score: 7 } } }],
  },
  {
    id: 'multi-route',
    source: `import { Router } from '@pulse-compute/runtime';
const api = new Router();
const app = new Router();
api.get('/health', async (ctx) => ctx.json({ ok: true }));
api.get('/users/:id', async (ctx) => ctx.json({ id: ctx.param('id') }));
api.post('/users', async (ctx) => ctx.json({ created: true }, { status: 201 }));
app.mount('/api', api);
app.get('/*', async (ctx) => ctx.text('missing', { status: 404 }));
export default app;\n`,
    cases: [
      { request: { method: 'GET', path: '/api/users/42' }, expected: { status: 200, json: { id: '42' } } },
      { request: { method: 'GET', path: '/api/health' }, expected: { status: 200, json: { ok: true } } },
      { request: { method: 'POST', path: '/api/users' }, expected: { status: 201, json: { created: true } } },
      { request: { method: 'GET', path: '/other' }, expected: { status: 404, text: 'missing' } },
    ],
  },
];
// Fixed scale fixture, not a substitute for Catalog or a production workload.
// All 64 paths are correctness checked; this cell measures compilation only.
const schemaCount = 16, routeCount = 64;
const large = {
  id: 'large-router-compile', targets: ['native'], runtime: false,
  source: `import { Router } from '@pulse-compute/runtime';\nimport type { ${Array.from({ length: schemaCount }, (_, i) => 'Input' + i).join(', ')} } from './schemas';\nconst app = new Router();\n`
    + Array.from({ length: routeCount }, (_, i) => `app.post('/items/${i}', async (ctx) => { const input = await ctx.req.json<Input${i % schemaCount}>('bench.Input${i % schemaCount}'); return ctx.json({ value: input.value, route: ${i} }, { schema: 'bench.Output${i % schemaCount}' }); });`).join('\n') + '\nexport default app;\n',
  schema: `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';\n`
    + Array.from({ length: schemaCount }, (_, i) => `export interface Input${i} { value: string }\nexport interface Output${i} { value: string; route: number }`).join('\n')
    + '\nexport default defineSchemaRegistry({ schemas: {\n' + Array.from({ length: schemaCount }, (_, i) => `'bench.Input${i}': schema<Input${i}>(), 'bench.Output${i}': schema<Output${i}>(),`).join('\n') + '\n} });\n',
  cases: Array.from({ length: routeCount }, (_, i) => ({ request: { method: 'POST', path: '/items/' + i, headers: { 'content-type': 'application/json' }, body: '{"value":"sample"}' }, expected: { status: 200, json: { value: 'sample', route: i } } })),
};
module.exports = { fixtures, perf8Fixtures: [...fixtures, large] };
