'use strict';

const { validateHeaderName, validateHeaderValue } = require('node:http');
const { PulseRuntimeContractError } = require('@pulse-compute/runtime/host');
const limits = Object.freeze({ chunkBytes: 16384, writes: 64, totalBytes: 1048576 });
const error = (code, message) => new PulseRuntimeContractError(code, message);

function normalizeGeneratedOutput(value, duration) {
  if (value === undefined) return undefined;
  if (value !== true || !Number.isInteger(duration) || duration < 1 || duration > 30000) {
    throw error('PULSE_OUTPUT_CONFIG_INVALID', 'node.generatedOutput must be true and requires node.maxDurationMs (1–30000).');
  }
  return true;
}

// One request-owned writer. It never stores a queue of application chunks.
function createGeneratedOutput(response, options) {
  if (!options.generatedOutput) return undefined;
  normalizeGeneratedOutput(options.generatedOutput, options.maxDurationMs);
  const transform = require('./body-transform.js');
  transform.normalizeBodyTransform(options.bodyTransform, options);
  let input, inputBytes = 0, inputDone = false, readStarted = false;
  const budget = options.requestBudget;
  if (!budget || budget.deadlineMonotonicMs === undefined) throw error('PULSE_OUTPUT_UNAVAILABLE', 'Generated output requires a shared request deadline.');
  let phase = 'idle', committed = false, busy = false, bytes = 0, writes = 0, failure, completion;
  let status = 200, headers = [];
  const completions = new WeakSet();
  function cancel(reason) {
    if (phase === 'finished') return;
    failure ||= reason || error('PULSE_OUTPUT_CANCELLED', 'Generated output was cancelled.');
    phase = 'failed';
    if (committed && !response.destroyed) response.destroy();
  }
  const removeAbort = budget.onAbort(() => cancel(budget.signal.reason));
  function check() { if (failure) throw failure; budget.check(); }
  function assertEffect() {
    check();
    if (phase === 'closing' || phase === 'finished') throw error('PULSE_OUTPUT_CLOSED', 'No effect may run after output.close().');
  }
  async function dispatch(effect) {
    try {
      assertEffect();
      if (busy) throw error('PULSE_OUTPUT_OWNERSHIP', 'Generated output allows one awaited write at a time.');
      busy = true;
      if (effect.kind === 'output.readTextChunk') {
        if (!options.bodyTransform || !input) throw error('PULSE_TRANSFORM_UNAVAILABLE', 'Text chunks require configured Node transform input.');
        if (inputDone) throw error('PULSE_TRANSFORM_CLOSED', 'Transform input has reached EOF.');
        readStarted = true;
        const chunk = await input.readTextChunk(budget);
        check();
        inputBytes += Buffer.byteLength(chunk.text);
        inputDone = chunk.done;
        return chunk;
      }
      if (effect.kind === 'output.start') {
        if (phase !== 'idle') throw error('PULSE_OUTPUT_OWNERSHIP', 'Generated output may start once.');
        const init = effect.argument0 || {};
        if (typeof init !== 'object' || Array.isArray(init) || Object.keys(init).some(key => !['status', 'headers'].includes(key))) {
          throw error('PULSE_OUTPUT_OPTIONS_INVALID', 'Generated output accepts only status and headers.');
        }
        status = init.status === undefined ? 200 : init.status;
        if (!Number.isInteger(status) || status < 200 || status > 599 || [204, 205, 304].includes(status)
          || String(options.requestMethod).toUpperCase() === 'HEAD') {
          throw error('PULSE_OUTPUT_BODYLESS', 'Generated output requires a response that permits a body.');
        }
        headers = Array.isArray(init.headers) ? init.headers : Object.entries(init.headers || {});
        if (headers.length > 64) throw error('PULSE_OUTPUT_LIMIT_EXCEEDED', 'Too many generated output headers.');
        let headerBytes = 0;
        headers = headers.map(pair => {
          if (!Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string')) throw error('PULSE_OUTPUT_OPTIONS_INVALID', 'Headers must be string pairs.');
          const [name, value] = pair;
          validateHeaderName(name); validateHeaderValue(name, value);
          if (['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'trailer', 'te', 'host', 'proxy-connection'].includes(name.toLowerCase())) {
            throw error('PULSE_OUTPUT_OPTIONS_INVALID', 'Generated output forbids framing and hop-by-hop headers.');
          }
          headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
          if (headerBytes > 16384) throw error('PULSE_OUTPUT_LIMIT_EXCEEDED', 'Generated output headers exceed 16 KiB.');
          return Object.freeze([name, value]);
        });
        check();
        response.statusCode = status;
        for (const [name, value] of headers) response.setHeader(name, value);
        if (!response.hasHeader?.('content-type')) response.setHeader('content-type', 'text/plain; charset=utf-8');
        phase = 'open'; committed = true;
        response.flushHeaders?.();
        return undefined;
      }
      if (effect.kind !== 'output.write' || phase !== 'open') throw error('PULSE_OUTPUT_OWNERSHIP', 'Call output.start() before output.write().');
      const text = effect.argument0;
      if (typeof text !== 'string') throw error('PULSE_OUTPUT_CHUNK_INVALID', 'Generated output writes require text.');
      // Bound before UTF-8 allocation; byte length remains authoritative.
      if (text.length > limits.chunkBytes) throw error('PULSE_OUTPUT_LIMIT_EXCEEDED', 'Generated output chunk exceeds 16 KiB.');
      const length = Buffer.byteLength(text);
      if (length > limits.chunkBytes || writes === limits.writes || length > limits.totalBytes - bytes) throw error('PULSE_OUTPUT_LIMIT_EXCEEDED', 'Generated output exceeded its chunk, write-count or total-byte limit.');
      if (options.bodyTransform && (bytes + length > transform.limits.outputBytes || bytes + length > inputBytes * transform.limits.expansion)) {
        throw error('PULSE_TRANSFORM_OUTPUT_LIMIT', 'Transform output exceeds 262144 bytes or four times delivered input bytes.');
      }
      writes++; bytes += length;
      await waitForWrite(Buffer.from(text));
      check();
    } catch (reason) { cancel(reason); throw failure; }
    finally { busy = false; }
  }
  function waitForWrite(chunk) {
    return budget.race(new Promise((resolve, reject) => {
      let callbackDone = false, drained = false, returned = false, settled = false;
      const cleanup = () => { response.removeListener('error', fail); response.removeListener('close', closed); response.removeListener('drain', drain); budget.signal.removeEventListener('abort', aborted); };
      const fail = reason => { if (settled) return; settled = true; cleanup(); reject(reason); };
      const done = () => { if (returned && callbackDone && drained && !settled) { settled = true; cleanup(); resolve(); } };
      const closed = () => fail(error('PULSE_OUTPUT_CANCELLED', 'Output writer closed before completion.'));
      const aborted = () => fail(budget.signal.reason);
      const drain = () => { drained = true; done(); };
      response.once('error', fail); response.once('close', closed); response.on('drain', drain); budget.signal.addEventListener('abort', aborted, { once: true });
      try {
        check();
        const accepted = response.write(chunk, reason => { if (reason) fail(reason); else { callbackDone = true; done(); } });
        drained ||= accepted; returned = true; done();
      } catch (reason) { fail(reason); }
    }));
  }
  return Object.freeze({
    dispatch, assertEffect, cancel,
    bindInput(value) {
      if (!options.bodyTransform) return;
      if (input && input !== value) throw error('PULSE_REQUEST_BODY_OWNERSHIP', 'Transform input is already bound.');
      input = value;
    },
    get started() { return phase !== 'idle'; },
    get finished() { return phase === 'finished'; },
    close(factory) {
      try {
        check();
        if (phase !== 'open' || busy) throw error('PULSE_OUTPUT_OWNERSHIP', 'Return output.close() after all writes settle.');
        if (options.bodyTransform && !inputDone) throw error('PULSE_TRANSFORM_EOF_REQUIRED', 'Read transform input through EOF before output.close().');
        phase = 'closing';
        completion = factory ? factory({ status, headers }) : Object.freeze({ status, headers, kind: 'text', bodyClass: 'structured', body: '' });
        completions.add(completion);
        return completion;
      } catch (reason) { cancel(reason); throw failure; }
    },
    validateResult(result) {
      check();
      if ((phase !== 'idle' || readStarted) && (phase !== 'closing' || !completions.has(result))) throw error('PULSE_OUTPUT_CLOSE_REQUIRED', 'A generated-output handler must return its output.close() result.');
    },
    async finish() {
      if (phase === 'idle') return;
      try {
        check();
        if (phase !== 'closing') throw error('PULSE_OUTPUT_CLOSE_REQUIRED', 'Generated output did not close.');
        await budget.race(new Promise((resolve, reject) => {
          const cleanup = () => { response.removeListener('finish', done); response.removeListener('error', fail); response.removeListener('close', closed); budget.signal.removeEventListener('abort', aborted); };
          const done = () => { cleanup(); resolve(); };
          const fail = reason => { cleanup(); reject(reason); };
          const closed = () => { if (!response.writableFinished) fail(error('PULSE_OUTPUT_CANCELLED', 'Output closed before finish.')); };
          const aborted = () => fail(budget.signal.reason);
          response.once('finish', done); response.once('error', fail); response.once('close', closed); budget.signal.addEventListener('abort', aborted, { once: true });
          try { check(); response.end(); } catch (reason) { fail(reason); }
        }));
        check(); phase = 'finished';
      } catch (reason) { cancel(reason); throw failure; }
    },
    dispose() { removeAbort(); if (!['idle', 'finished'].includes(phase)) cancel(); },
    snapshot() { return Object.freeze({ phase, bytes, writes, ...(options.bodyTransform ? { inputBytes, inputDone, expansionRatio: inputBytes ? bytes / inputBytes : 0 } : {}) }); }
  });
}

module.exports = { limits, normalizeGeneratedOutput, createGeneratedOutput };
