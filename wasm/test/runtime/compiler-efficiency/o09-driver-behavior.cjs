'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root, hash, kind, build, observe, execute, probeHost } = require('./o09-driver-fixture.cjs');
const range = n => Array.from({ length: n }, (_, i) => i);
const tuple = value => [value.error, value.stage, value.effect];
const errors = { json: [1004, 3, -1], schema: [1005, 52, -1] };
const url = i => `https://proof.example.invalid/s${i}`;

function cases(count, topology) {
  const result = [
    { name: 'success-a' }, { name: 'success-b', marker: 'B' },
    { name: 'zero-pending-handle', zero: true },
    { name: 'malformed-json', faults: { 0: 'json' }, recovery: 'PULSE_SCHEMA_JSON_MALFORMED', error: errors.json },
    { name: 'wrong-schema', faults: { 0: 'schema' }, recovery: 'PULSE_SCHEMA_DECODE', error: errors.schema },
    { name: 'transport-failure', faults: { 0: 'transport' }, error: [1006, 81, 0], fatal: true },
    { name: 'send-failure', faults: { 0: 'send' }, error: [1006, 77, 0], fatal: true }
  ];
  if (count > 1 && topology === 'parallel') result.push({ name: 'missing-config', missing: true });
  if (count > 1 && topology === 'parallel') result.push(
    { name: 'malformed-body-and-later-transport', faults: { 0: 'json', 2: 'transport' }, error: [1006, 81, 2], fatal: true },
    { name: 'transport-and-later-malformed-body', faults: { 0: 'transport', 3: 'json' }, error: [1006, 81, 0], fatal: true },
    { name: 'two-fatal', faults: { 0: 'transport', 2: 'transport' }, error: [1006, 81, 0], fatal: true },
    { name: 'json-then-schema', faults: { 0: 'json', 3: 'schema' }, recovery: 'PULSE_SCHEMA_JSON_MALFORMED', error: errors.json },
    { name: 'schema-then-json', faults: { 0: 'schema', 3: 'json' }, recovery: 'PULSE_SCHEMA_DECODE', error: errors.schema }
  );
  if (topology === 'sequential') result.push(
    { name: 'later-schema-failure', faults: { 3: 'schema' }, recovery: 'PULSE_SCHEMA_DECODE', error: errors.schema },
    { name: 'later-transport-failure', faults: { 3: 'transport' }, error: [1006, 81, 3], fatal: true }
  );
  return result;
}

function optionsFor(count, scenario) {
  const marker = scenario.marker || 'A', fixtures = {}, config = {}, values = [];
  for (const i of range(count)) {
    const value = `${marker}${i}`;
    values.push(scenario.missing && kind(i) === 'config' ? 'missing' : value);
    if (kind(i) === 'config') { if (!scenario.missing) config[`K${i}`] = value; continue; }
    fixtures[url(i)] = { body: kind(i) === 'json' ? JSON.stringify({ id: value }) : value,
      headers: { 'content-type': kind(i) === 'json' ? 'application/json' : 'text/plain' } };
  }
  for (const [index, fault] of Object.entries(scenario.faults || {})) {
    const fixture = fixtures[url(index)];
    if (fault === 'json') fixture.body = '{';
    else if (fault === 'schema') fixture.body = '{"id":42}';
    else if (fault === 'transport') fixture.transportStatus = 1;
    else if (fault === 'send') fixture.sendStatus = 1;
    else throw new Error('Unknown fault: ' + fault);
  }
  return { options: { request: { method: 'GET', path: '/run' }, configStore: 'o09', config, fixtures,
    ...(scenario.zero ? { handleStarts: { pending: 0 } } : {}) }, expectedBody: values.join('|') };
}

function assertRun(count, topology, scenario, actual, observer, expectedBody) {
  const events = observer.events, select = name => events.filter(e => e.event === name);
  const faults = scenario.faults || {}, firstFailure = Math.min(...Object.keys(faults).map(Number));
  const active = range(topology === 'sequential' && scenario.error ? firstFailure + 1 : count);
  const begun = select('begin-after'), settled = select('settle-after'), resumed = select('resume-before');
  assert.deepEqual(begun.map(e => e.index), active, 'admission order');
  assert.deepEqual(settled.map(e => e.index), active, 'exactly one ordered settlement per admitted site');
  for (const e of begun) { assert.equal(e.status, 1); assert.equal(e.ticket, e.index + 1); }
  for (const e of select('settle-before')) {
    assert.equal(e.ticket, e.index + 1); assert.equal(e.currentTicket, e.ticket);
    assert.equal(e.pending, 1); assert.equal(e.ready, 0); assert.equal(e.mode, 0);
    assert.ok(e.result > 0, 'settlement always supplies a real value handle');
    if ((faults[e.index] && (topology === 'sequential' || ['transport', 'send'].includes(faults[e.index]))) || (faults[0] === 'send' && topology === 'parallel')) assert.equal(e.resultKind, 0, 'failed/suppressed result is undefined');
  }
  assert.deepEqual(select('setter-before').map(e => e.index), active);
  for (const e of select('setter-before')) assert.equal(e.currentTicket, 0, 'ticket consumed before guest setter');
  for (const e of settled) {
    assert.equal(e.status, 1); assert.equal(e.currentTicket, 0); assert.equal(e.ready, 1); assert.equal(e.stored, e.result);
  }
  const resolved = faults[0] === 'send' ? [] : active;
  assert.deepEqual(select('resolve-before').map(e => e.index), resolved);
  for (const e of select('resolve-before')) assert.equal(e.mode, kind(e.index) === 'config' ? 2 : 1);
  for (const e of select('resolve-after')) {
    assert.equal(e.mode, 0);
    if (faults[e.index] === 'transport') assert.deepEqual(tuple(e), [1006, 81, e.index]);
    else if (topology === 'sequential' && faults[e.index]) assert.deepEqual(tuple(e), errors[faults[e.index]]);
    else assert.deepEqual(tuple(e), [0, 0, -1]);
  }
  if (topology === 'parallel') {
    assert.ok(events.indexOf(begun.at(-1)) < events.findIndex(e => e.event === 'settle-before'));
    assert.equal(resumed.length, scenario.fatal ? 0 : 1);
  } else {
    assert.equal(resumed.length, active.length - (scenario.fatal ? 1 : 0));
    for (const i of active.slice(1)) assert.ok(events.indexOf(settled[i - 1]) < events.indexOf(begun[i]));
  }
  for (const e of resumed) assert.equal(e.openTickets, 0, 'drain all tickets before resume');
  if (scenario.recovery) {
    assert.deepEqual(tuple(resumed.at(-1)), topology === 'parallel' ? [0, 0, -1] : scenario.error,
      'grouped fetch data validates on resume; sequential projection validates during resolution');
    const take = select('error-take-before').find(e => e.error !== 0);
    assert.ok(take, 'application recovery observes the provider error');
    assert.deepEqual(tuple(take), scenario.error); assert.equal(take.openTickets, 0);
    assert.ok(events.indexOf(settled.at(-1)) < events.indexOf(take), 'all siblings settle before recovery');
  }
  if (scenario.fatal) { assert.equal(actual.response, null); assert.deepEqual(tuple(actual.failure), scenario.error); }
  else {
    assert.equal(actual.failure, null);
    assert.equal(actual.response.status, scenario.recovery ? 422 : 200);
    assert.equal(actual.response.body, scenario.recovery || expectedBody);
  }
  const state = observer.state();
  assert.deepEqual(tuple(state), scenario.fatal ? scenario.error : [0, 0, -1]);
  assert.equal(state.count, active.length); assert.equal(state.closed, true);
  assert.deepEqual(state.tickets, range(count).map(() => 0));
  const eventCount = events.length, hostcallCount = observer.trace.length;
  observer.instance.exports._start();
  assert.equal(events.length, eventCount, 'closed invocation cannot reenter driver');
  assert.equal(observer.trace.length, hostcallCount, 'reentry performs no hostcalls');
  assert.deepEqual(tuple(observer.state()), scenario.fatal ? scenario.error : [1007, 171, -1]);
  assert.deepEqual(observer.state().tickets, state.tickets);
  return { admitted: active.length, settled: settled.length, resolved: resolved.length, resumes: resumed.length, final: state };
}

// Private exports arm actual generated slots and call the actual ticket helper/guest setter.
// Numeric tickets are instance-local internal state, not cross-instance capabilities.
function assertTickets(wasm, count, directory) {
  const observer = observe(count); observer.skipStart = true;
  const { instance } = probeHost(wasm, { o09: observer, request: { method: 'GET', path: '/run' } });
  const e = instance.exports, oldValue = e.o09_value(101), freshValue = e.o09_value(202), poison = e.o09_value(999);
  const slot = index => range(3).map(field => e.o09_slot(index, field));
  const setters = () => observer.events.filter(event => event.event === 'setter-before').length;
  let rejected = 0;
  function reject(action) {
    e.o09_clear_error();
    const slots = range(count).map(slot), tickets = observer.state().tickets, calls = setters(), admissions = e.o09_count();
    assert.equal(action(), 0); rejected++;
    assert.deepEqual(tuple(observer.state()).slice(0, 2), [1007, 171]);
    assert.deepEqual(range(count).map(slot), slots); assert.deepEqual(observer.state().tickets, tickets);
    assert.equal(setters(), calls, 'rejected ticket never reaches guest setter'); assert.equal(e.o09_count(), admissions);
    e.o09_clear_error();
  }
  e.o09_arm(0); assert.equal(e.o09_begin(0), 1); const first = e.o09_ticket(0);
  reject(() => e.o09_begin(0));
  reject(() => e.o09_settle(0, 0, poison));
  reject(() => e.o09_settle(0, first + 1, poison));
  reject(() => e.o09_settle(-1, first, poison));
  reject(() => e.o09_settle(count, first, poison));
  if (count > 1) {
    e.o09_arm(count - 1); assert.equal(e.o09_begin(count - 1), 1); const other = e.o09_ticket(count - 1);
    reject(() => e.o09_settle(count - 1, first, poison));
    reject(() => e.o09_settle(0, other, poison));
    assert.equal(e.o09_settle(count - 1, other, freshValue), 1);
  }
  assert.equal(e.o09_settle(0, first, oldValue), 1); assert.deepEqual(slot(0), [1, 1, oldValue]);
  reject(() => e.o09_settle(0, first, poison));
  e.o09_arm(0); assert.equal(e.o09_begin(0), 1); const second = e.o09_ticket(0);
  assert.ok(second > first); assert.deepEqual(slot(0), [1, 0, oldValue]);
  reject(() => e.o09_settle(0, first, poison));
  assert.equal(e.o09_settle(0, second, freshValue), 1); assert.deepEqual(slot(0), [1, 1, freshValue]);
  assert.equal(e.o09_number(e.o09_slot(0, 2)), 202); assert.equal(e.o09_number(oldValue), 101);
  e.o09_arm(0); assert.equal(e.o09_begin(0), 1); const late = e.o09_ticket(0);
  e.o09_close(); assert.deepEqual(observer.state().tickets, range(count).map(() => 0));
  reject(() => e.o09_settle(0, late, poison)); reject(() => e.o09_begin(0));
  assert.equal(setters(), count > 1 ? 3 : 2);
  fs.writeFileSync(path.join(directory, 'ticket-probes.json'), JSON.stringify(observer.events, null, 2) + '\n');
  return { rejected, accepted: setters(), eventsSha256: hash(JSON.stringify(observer.events)) };
}

// Router decodes fetch projections on resume. These separately labelled probes
// inject recoverable provider diagnostics after resolution to freeze the driver's
// saved-error arbitration, without claiming those branches were reached by JSON HTTP data.
function assertPriority(wasm, count, directory) {
  const scenarios = [
    { name: 'json-first', injected: { 0: 1004 }, expected: errors.json, recovery: 'PULSE_SCHEMA_JSON_MALFORMED' },
    { name: 'schema-first', injected: { 0: 1005 }, expected: errors.schema, recovery: 'PULSE_SCHEMA_DECODE' }
  ];
  if (count > 1) scenarios.push(
    { name: 'json-then-schema', injected: { 0: 1004, 3: 1005 }, expected: errors.json, recovery: 'PULSE_SCHEMA_JSON_MALFORMED' },
    { name: 'schema-then-json', injected: { 0: 1005, 3: 1004 }, expected: errors.schema, recovery: 'PULSE_SCHEMA_DECODE' },
    { name: 'recoverable-then-fatal', injected: { 0: 1004 }, faults: { 2: 'transport' }, expected: [1006, 81, 2] },
    { name: 'fatal-then-recoverable', injected: { 3: 1004 }, faults: { 0: 'transport' }, expected: [1006, 81, 0] }
  );
  return scenarios.map(scenario => {
    const observer = observe(count), attach = observer.attach;
    observer.attach = (instance, trace) => {
      attach(instance, trace);
      for (const [index, code] of Object.entries(scenario.injected)) instance.exports.o09_fault(Number(index), code);
    };
    const actual = execute(wasm, optionsFor(count, scenario).options, observer);
    const settlements = observer.events.filter(e => e.event === 'settle-after');
    assert.deepEqual(settlements.map(e => e.index), range(count));
    for (const e of settlements) {
      assert.equal(e.status, 1); assert.equal(e.currentTicket, 0); assert.equal(e.mode, 0);
      if (scenario.injected[e.index] || scenario.faults?.[e.index]) assert.equal(e.resultKind, 0);
    }
    const resumes = observer.events.filter(e => e.event === 'resume-before');
    if (scenario.recovery) {
      assert.equal(resumes.length, 1); assert.equal(resumes[0].openTickets, 0);
      assert.deepEqual(tuple(resumes[0]), scenario.expected);
      assert.equal(actual.failure, null); assert.equal(actual.response.status, 422); assert.equal(actual.response.body, scenario.recovery);
    } else { assert.equal(resumes.length, 0); assert.deepEqual(tuple(actual.failure), scenario.expected); }
    assert.equal(observer.state().closed, true); assert.deepEqual(observer.state().tickets, range(count).map(() => 0));
    fs.writeFileSync(path.join(directory, 'priority-' + scenario.name + '.json'), JSON.stringify({ events: observer.events, trace: actual.trace }, null, 2) + '\n');
    return { name: scenario.name, expected: scenario.expected, settlements: settlements.length,
      response: actual.response, failure: actual.failure, eventsSha256: hash(JSON.stringify(observer.events)) };
  });
}

function main() {
  const directory = path.join(root, 'wasm/.test-results/compiler-efficiency', 'o09-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const report = { schemaVersion: 'pulse.o09-driver-behavior.v1', status: 'running',
    source: { commit: git(['rev-parse', 'HEAD']), worktree: git(['status', '--short']),
      testSha256: Object.fromEntries(['o09-driver-behavior.cjs', 'o09-driver-fixture.cjs'].map(name => [name, hash(fs.readFileSync(path.join(__dirname, name)))])) },
    node: process.version, fixtures: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  save();
  try {
    for (const [count, topology] of [[1, 'parallel'], [8, 'parallel'], [32, 'parallel'], [8, 'sequential']]) {
      const fixtureDirectory = path.join(directory, `${count}-${topology}`), fixture = build(count, topology, fixtureDirectory);
      const entry = { ...fixture.identity, cases: [], tickets: assertTickets(fixture.diagnostic, count, fixtureDirectory),
        priorityProbes: topology === 'parallel' ? assertPriority(fixture.diagnostic, count, fixtureDirectory) : [] }; report.fixtures.push(entry); save();
      for (const scenario of cases(count, topology)) {
        const { options, expectedBody } = optionsFor(count, scenario), observer = observe(count);
        const production = execute(fixture.production, options), diagnostic = execute(fixture.diagnostic, options, observer);
        const publicResult = value => ({ response: value.response, failure: value.failure, trace: value.trace });
        const raw = { production: publicResult(production), diagnostic: publicResult(diagnostic), events: observer.events };
        fs.writeFileSync(path.join(fixtureDirectory, scenario.name + '.json'), JSON.stringify(raw, null, 2) + '\n');
        assert.deepEqual(publicResult(diagnostic), publicResult(production), 'production/diagnostic public output and full hostcall trace parity');
        const summary = assertRun(count, topology, scenario, diagnostic, observer, expectedBody);
        entry.cases.push({ name: scenario.name, response: production.response, failure: production.failure,
          traceSha256: hash(JSON.stringify(production.trace)), eventsSha256: hash(JSON.stringify(observer.events)), ...summary }); save();
      }
      console.log(`O-09 ${count} ${topology}: ${entry.cases.length} scenarios + ticket ownership/freshness passed`);
    }
    report.status = 'passed'; save();
    if (process.argv.includes('--record')) fs.writeFileSync(path.join(__dirname, 'o09-evidence.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('O-09 passed: ' + path.relative(root, path.join(directory, 'report.json')));
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; save(); throw error; }
}
if (require.main === module) main();
