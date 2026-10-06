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
module.exports = { fixtures };
