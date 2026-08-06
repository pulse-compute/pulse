#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { Router } = require('../../../packages/runtime/src/index.js');
const { executeApplication } = require('../../../packages/runtime/src/host.js');

const app = new Router();
app.get('/', async (ctx) => {
  ctx.log.debug('debug secret-value');
  ctx.log.info('info secret-value');
  ctx.log.warn('warn secret-value');
  ctx.log.error('error secret-value');
  return ctx.text('ok');
});

void (async () => {
  const emitted = [];
  const observations = [];
  const response = await executeApplication(app, new Request('https://example.test/'), {
    reporting: 'warn',
    redactionValues: ['secret-value'],
    log(level, message) {
      emitted.push([level, message]);
      throw new Error('logging backend unavailable');
    },
    onLogObservation(event) {
      observations.push(event);
    }
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.deepEqual(emitted, [
    [2, 'warn <redacted>'],
    [1, 'error <redacted>']
  ]);
  assert.equal(observations[0].type, 'logging-config');
  assert.deepEqual(observations[0].reporting, { name: 'warn', level: 2 });
  assert.deepEqual(observations.slice(1).map((entry) => entry.name), ['warn', 'error']);
  assert.doesNotMatch(JSON.stringify(observations), /secret-value/);

  console.log('ok - JavaScript ctx.log filters synchronously, redacts messages, and contains provider sink failures');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
