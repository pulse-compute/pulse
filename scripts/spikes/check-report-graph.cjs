#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { index, atlasLayout } = require('./graph/model.cjs');
const { render } = require('./report-graph-html.cjs');
const f = require('../../wasm/test/cli/report-fixtures.cjs');
const { createCapsule, parseCapsule, serializeCapsule } = require('../../wasm/packages/cli/src/internal/report/capsule');
const missing = { state: 'unavailable', value: null, reason: 'not-recorded' };
const source = { state: 'available', value: { file: 'src/shared.ts', start: { line: 1, column: 1 } } };
const registration = (id, order, kind, mountPath, handlerId, flow = {}) => ({ id, order, kind, mountPath, handlerId, routerId: 'router', source, match: missing, flow: { next: null, child: null, parentContinue: null, ...flow } });
const sample = { bindings: [{ id: 'binding', name: 'STORE', kind: 'kv' }], analytics: {
  registrations: [registration('a', 0, 'mount', [], null, { child: 'a-use', next: 'b' }), registration('a-use', 1, 'route', ['a'], 'shared', { parentContinue: 'b' }), registration('b', 2, 'mount', [], null, { child: 'b-use' }), registration('b-use', 3, 'route', ['b'], 'shared'), registration('error', 4, 'error', [], 'error-handler'), registration('event', 5, 'event', [], 'event-handler')],
  handlers: [{ id: 'shared', name: 'shared', source }],
  useSites: [{ id: 'use', ownerId: 'shared', capability: { state: 'available', value: 'kv.read' }, binding: { state: 'resolved', bindingId: 'binding' } }],
  associations: [{ id: 'association', consumerRegistrationId: 'a-use', useSiteId: 'use', conditional: null, lane: 'normal', via: [{ id: 'a', kind: 'mount' }, { id: 'a-use', kind: 'direct' }] }]
} };
const original = JSON.stringify(sample), m = index(sample);
assert.deepEqual(m.children.get('a').map(r => r.id), ['a-use']);
assert.deepEqual(m.children.get('b').map(r => r.id), ['b-use']);
assert.equal(m.instances.get('shared').length, 2, 'reuse preserves distinct mount instances');
assert.equal(m.definitions.size, 1, 'reuse does not duplicate the authored definition');
assert.deepEqual(m.neighbors('a-use').incoming, [{ from: 'a', to: 'a-use', kind: 'child' }]);
assert.deepEqual(m.neighbors('a-use').outgoing, [{ from: 'a-use', to: 'b', kind: 'parentContinue' }]);
assert.equal(m.lane(m.byId.get('error')), 'error'); assert.equal(m.lane(m.byId.get('event')), 'event');
assert.deepEqual(m.dependency('binding:binding').consumers, ['a-use'], 'never invent missing contextual consumers from shared definitions');
assert.equal(m.dependency('cap:kv.read').rows[0].conditional, null, 'unknown conditionality stays unknown');
assert.equal(JSON.stringify(sample), original, 'presentation never mutates evidence');
const scoped = atlasLayout(m, { scope: 'a' });
assert.deepEqual(scoped.placements.filter(p => p.r).map(p => p.r.id).sort(), ['a', 'a-use']);
assert.ok(!scoped.placements.some(p => p.r?.id === 'b-use'), 'shared handler reuse cannot pull another mount into the focused scope');
assert.equal(scoped.edges.length, 1, 'scope layout only adds retained containment edges');
const open = new Set(), filtered = atlasLayout(m, { open, query: 'b-use' });
assert.equal(open.size, 0, 'search expansion never mutates saved expansion state');
assert.deepEqual(filtered.matches.map(r => r.id), ['b-use']);
assert.ok(filtered.placements.some(p => p.r?.id === 'b'), 'search includes the exact mount ancestry');
assert.ok(!filtered.placements.some(p => p.r?.id === 'a'), 'search does not borrow another instance of a shared definition');
assert.equal(atlasLayout(m, { scope: 'a', query: 'b-use' }).placements.length, 0, 'empty scoped results remain empty');
assert.deepEqual(atlasLayout(m, { open: new Set(['a', 'b']) }), atlasLayout(m, { open: new Set(['b', 'a']) }), 'layout depends on registration order, not interaction order');
assert.equal(JSON.stringify(sample), original, 'navigation does not change the capsule');
const historical = f.fixture(); historical.application.name = '</script><svg onload=alert(1)>\u2028&';
const capsule = createCapsule(historical), wire = serializeCapsule(capsule), html = render(capsule);
const payload = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1];
assert.ok(!payload.includes('<svg')); assert.equal(serializeCapsule(parseCapsule(payload)), wire);
assert.equal(index(capsule).a, undefined, 'historical absence stays unavailable');
assert.ok(html.includes("connect-src 'none'"));
assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html), 'self-contained assets only');
console.log('PASS: mount reuse, retained link types, lane separation, missing associations, immutable evidence, legacy absence, inert payload and exact export.');
