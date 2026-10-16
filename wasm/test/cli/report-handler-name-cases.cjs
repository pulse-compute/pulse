'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { setup } = require('../support/report-analytics-fixture.cjs');
const { compileProject } = require('../../packages/cli/src/project-execution');
const { resolveProject } = require('../../packages/cli/src/project-config');
const router = require('../../packages/compiler/src/spine/canonical-router');
const { collectHandlerTopology } = require('../../packages/compiler/src/report-handler-topology');

module.exports = function nameCases(parent) {
  const directory = path.join(parent, 'names');
  setup(directory);
  try {
    fs.writeFileSync(path.join(directory, 'src/named.ts'), `
export async function declared(ctx) { return ctx.text('declared'); }
export const assigned = async function expressionName(ctx) { return ctx.text('assigned'); };
const original = async ctx => ctx.text('original');
export { original as exportedAlias };
export const duplicate = async ctx => ctx.text('first');
`);
    fs.writeFileSync(path.join(directory, 'src/other.ts'), "export const duplicate = async ctx => ctx.text('second');\n");
    fs.writeFileSync(path.join(directory, 'src/index.ts'), `
import { Pulse } from '@pulse-compute/pulse';
import { Router } from '@pulse-compute/runtime';
import { declared as importedAlias, assigned, exportedAlias, duplicate as first } from './named';
import { duplicate as second } from './other';
const app = new Pulse({ auto: true });
const child = new Router();
const local = async ctx => ctx.text('local');
app.use(async (ctx, next) => next());
child.get('/declared', importedAlias);
app.mount('/one', child);
app.mount('/two', child);
app.get('/assigned', assigned);
app.get('/exported', exportedAlias);
app.get('/first', first);
app.get('/second', second);
app.get('/local', local);
app.get('/inline', async function inlineExpression(ctx) { return ctx.text('inline'); });
app.error(async (error, ctx, next) => ctx.text('error'));
app.on('named.event', { schema: null }, async ctx => { ctx.state.set('event', 'yes'); });
export default app;
`);
    // Planning covers both entry lanes without requiring the isolated #329
    // combined Native-generation defect to pass or to remain broken.
    const compiled = compileProject(resolveProject({ cwd: directory, metadataOnly: true }));
    const topology = router.topologyForCanonicalRouterOutput(compiled.router);
    const observed = collectHandlerTopology(compiled), records = observed.handlers;
    for (const name of ['declared', 'assigned', 'original', 'local']) assert.equal(records.filter(h => h.name === name).length, 1, name);
    assert.equal(records.filter(h => h.name === 'duplicate').length, 2, 'names never merge definitions');
    assert.ok(!records.some(h => ['importedAlias', 'exportedAlias', 'first', 'second', 'expressionName'].includes(h.name)), 'declaration-local name wins over aliases and expression names');
    const declared = records.find(h => h.name === 'declared');
    assert.equal(observed.registrations.filter(r => r.handlerId === declared.id).length, 2);
    const inline = topology.handlerTable.handlers.filter(h => h.inlineName);
    assert.equal(inline.length, 4);
    for (const h of inline) assert.equal(records.find(r => r.id === h.id).name, h.inlineName, 'retained inline context survives unchanged');
    assert.ok(observed.registrations.filter(r => r.kind === 'mount').every(r => r.handlerId === null));

    // Exercise metadata absence and export-only fallback at the observation
    // seam. Never mutate compiler tables or change executable identities.
    const file = require.resolve('../../packages/compiler/src/report-handler-topology');
    const owner = new Module(file, module), original = owner.require.bind(owner);
    owner.filename = file; owner.paths = Module._nodeModulePaths(path.dirname(file));
    let names;
    owner.require = name => name === './spine/canonical-router' ? { ...router,
      topologyForCanonicalRouterOutput: () => ({ ...topology, handlerTable: { ...topology.handlerTable,
        handlers: topology.handlerTable.handlers.map((h, i) => i ? h : { ...h, ...names }) } }) } : original(name);
    owner._compile(fs.readFileSync(file, 'utf8'), file);
    for (const [metadata, expected] of [
      [{ localName: 'local', exportName: 'exported', inlineName: '<inline>' }, 'local'],
      [{ localName: '', exportName: 'exported', inlineName: '<inline>' }, 'exported'],
      [{ localName: null, exportName: undefined, inlineName: '<inline>' }, '<inline>'],
      [{ localName: undefined, exportName: null, inlineName: undefined }, null]
    ]) {
      names = metadata;
      const result = owner.exports.collectHandlerTopology(compiled);
      assert.equal(result.handlers[0].name, expected);
      assert.deepEqual({ ...result.handlers[0], name: observed.handlers[0].name }, observed.handlers[0]);
      assert.deepEqual(result.registrations, observed.registrations);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};
