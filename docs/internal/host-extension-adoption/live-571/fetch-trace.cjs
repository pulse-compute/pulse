'use strict';
// Operator diagnostics only: preserve requests, responses, errors and signals.
// Never log headers, credentials, request bodies, query strings or responses.
const original = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const label = `${init?.method || 'GET'} ${url.origin}${url.pathname}`;
  const start = performance.now();
  console.log(`[network] start ${label}`);
  try {
    const response = await original(input, init);
    console.log(`[network] ${response.status} ${Math.round(performance.now()-start)}ms ${label}`);
    return response;
  } catch (error) {
    console.log(`[network] ${error.name} ${Math.round(performance.now()-start)}ms ${label}`);
    throw error;
  }
};
