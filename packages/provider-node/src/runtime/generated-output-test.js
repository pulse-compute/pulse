'use strict';

// Explicit finite test-harness collector. HTTP execution never takes this path.
const { Writable } = require('node:stream');
const { createRequestBudget, PulseRuntimeContractError } = require('@pulse-compute/runtime/host');
const { createGeneratedOutput } = require('./generated-output.js');

function collector(options) {
  const chunks = [], headers = new Map();
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.hasHeader = name => headers.has(name.toLowerCase());
  const budget = options.requestBudget || createRequestBudget(options);
  const outputExecution = createGeneratedOutput(response, { ...options, requestBudget: budget });
  return {
    outputExecution, budget,
    body: () => Buffer.concat(chunks).toString('utf8'),
    headers: () => [...headers],
    dispose() { outputExecution?.dispose(); if (!options.requestBudget) budget.close(); }
  };
}

async function executeNative(native, options, execute) {
  if (!native.plan.capabilities.includes('response.output') || options.outputExecution) return execute(native, options);
  if (!options.outputCollect || !options.generatedOutput) throw new PulseRuntimeContractError('PULSE_OUTPUT_UNAVAILABLE', 'Generated output needs an HTTP writer or an explicit finite test collector.');
  const collected = collector({ ...options, requestMethod: options.request?.method || 'GET' });
  try {
    const result = await execute(native, { ...options, requestBudget: collected.budget, signal: collected.budget.signal, outputExecution: collected.outputExecution });
    if (!collected.outputExecution.started) return result;
    await collected.outputExecution.finish();
    return Object.freeze({ ...result, response: Object.freeze({ ...result.response, body: collected.body(), headers: collected.headers() }) });
  } finally { collected.dispose(); }
}

module.exports = { collector, executeNative };
