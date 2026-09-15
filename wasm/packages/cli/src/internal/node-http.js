'use strict';

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map((pair) => [String(pair[0]), String(pair[1])]);
  if (typeof headers[Symbol.iterator] === 'function') {
    return Array.from(headers, ([name, value]) => [String(name), String(value)]);
  }
  return Object.entries(headers).map(([name, value]) => [String(name), String(value)]);
}

function groupHeaders(headers) {
  const order = [];
  const groups = new Map();
  for (const [name, value] of normalizeHeaders(headers)) {
    const display = String(name);
    const lower = display.toLowerCase();
    if (!groups.has(lower)) {
      groups.set(lower, { name: display, values: [] });
      order.push(lower);
    }
    groups.get(lower).values.push(String(value));
  }
  return order.map((key) => groups.get(key));
}

function writeNodeHttpResponse(response, hostResult, options = {}) {
  options.requestBudget?.check();
  const result = hostResult || { status: 500, kind: 'empty', headers: [] };
  response.statusCode = result.status || 500;
  for (const group of groupHeaders(result.headers || [])) {
    response.setHeader(group.name, group.values.length === 1 ? group.values[0] : group.values.slice());
  }
  if (result.kind === 'stream' && result.bodyStream) {
    if (typeof result.bodyStream.pipe === 'function') {
      result.bodyStream.pipe(response);
      return result;
    }
    if (Array.isArray(result.bodyStream.chunks)) {
      for (const chunk of result.bodyStream.chunks) {
        response.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      response.end();
      return result;
    }
    if (typeof result.bodyStream === 'string' || Buffer.isBuffer(result.bodyStream)) {
      response.end(result.bodyStream);
      return result;
    }
  }
  const body = result.body === undefined || result.body === null ? '' : String(result.body);
  options.requestBudget?.check();
  response.end(body);
  return result;
}

module.exports = Object.freeze({ groupHeaders, writeNodeHttpResponse });
