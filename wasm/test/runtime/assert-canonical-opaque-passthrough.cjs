#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { EXAMPLES, compileExample } = require('../support/canonical-projects.cjs');
const { executeCanonicalProgram, normalizeFetchResponse } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { writeNodeResponse } = require('../../../packages/provider-node/src/runtime/assets-provider.js');

const program = compileExample(EXAMPLES.opaqueProxy).program;
const assetUrl = 'https://assets.example.com/archive.bin';

async function main() {
  const sourceStream = { chunks: [Buffer.from([0, 255]), Buffer.from([1, 2, 3])] };
  const execution = await executeCanonicalProgram(program, {
    request: { path: '/archive' },
    fetches: {
      [assetUrl]: {
        opaque: true,
        status: 206,
        headers: [
          ['content-type', 'application/octet-stream'],
          ['grip-channel', 'asset:a'],
          ['grip-channel', 'asset:b']
        ],
        bodyStream: sourceStream,
        responseRef: 77,
        streamRef: 88
      }
    }
  });

  assert.equal(execution.response.status, 206);
  assert.equal(execution.response.kind, 'stream');
  assert.equal(execution.response.bodyClass, 'opaque');
  assert.equal(execution.response.bodyStream, sourceStream, 'host-owned stream identity must survive canonical execution');
  assert.equal(Object.prototype.hasOwnProperty.call(execution.response, 'body'), false, 'opaque response must not acquire a buffered body');
  assert.deepEqual(execution.response.headers.filter(([name]) => name.toLowerCase() === 'grip-channel').map(([, value]) => value), ['asset:a', 'asset:b']);
  assert.equal(execution.response.hostOwnsStream, true);
  assert.equal(execution.response.wasmOwnsBytes, false);
  assert.equal(execution.response.bodyHandle.lifecycle.finalState, 'detached');
  assert.deepEqual(execution.continuations[0].states, ['created', 'waiting', 'resumed', 'completed']);

  const inspectable = normalizeFetchResponse({
    status: 206,
    kind: 'stream',
    headers: [['content-type', 'application/octet-stream']],
    bodyStream: sourceStream
  }, 'opaque-inspection-proof');
  for (const operation of ['text', 'json', 'bytes']) {
    assert.throws(() => inspectable[operation](), (error) => error.name === 'OpaqueBodyInspectionError' && error.code === 'PULSE_OPAQUE_BODY_INSPECTION');
  }

  const headers = new Map();
  const chunks = [];
  let ended = false;
  const res = {
    statusCode: 0,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    write(chunk) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      ended = true;
    }
  };
  writeNodeResponse(res, execution.response);
  assert.equal(res.statusCode, 206);
  assert.equal(ended, true);
  assert.deepEqual(headers.get('grip-channel'), ['asset:a', 'asset:b'], 'repeated headers must survive Node emission');
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 1, 2, 3]), 'binary chunks must not pass through UTF-8 coercion');

  const textualPassThrough = await executeCanonicalProgram(program, {
    request: { path: '/archive' },
    fetches: {
      [assetUrl]: {
        status: 200,
        kind: 'text',
        headers: [['content-type', 'text/plain; charset=utf-8']],
        body: 'plain pass-through'
      }
    }
  });
  assert.equal(textualPassThrough.response.bodyClass, 'opaque', 'direct fetch responses stay host-owned regardless of content type');
  assert.equal(textualPassThrough.response.body, undefined);
  assert.deepEqual(textualPassThrough.response.bodyStream.chunks, ['plain pass-through']);

  console.log('ok - direct fetch responses preserve host-owned binary and textual pass-through, exact bytes, repeated headers, and deny public body inspection');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
