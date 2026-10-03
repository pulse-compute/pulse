'use strict';

// Protocol-only helpers. The provider owns transport, deadlines and body handles.
function normalizeBodyOptions(input = {}) {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError('Invalid S3 body options.');
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!['method', 'range', 'ifNoneMatch'].includes(key) || !field.enumerable || !Object.hasOwn(field, 'value')) throw new TypeError('Invalid S3 body option.');
  }
  const method = input.method ?? 'GET';
  if (!['GET', 'HEAD'].includes(method)) throw new TypeError('S3 body method must be GET or HEAD.');
  if (input.range !== undefined) {
    const match = typeof input.range === 'string' && /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(input.range);
    if (method !== 'GET' || !match || !Number.isSafeInteger(Number(match[2])) || Number(match[1]) > Number(match[2])) throw new TypeError('S3 body requires one closed byte range.');
  }
  if (input.ifNoneMatch !== undefined && (typeof input.ifNoneMatch !== 'string' || input.ifNoneMatch.length > 1024
    || !/^(?:\*|(?:W\/)?"[\x21\x23-\x7e]*")$/.test(input.ifNoneMatch))) throw new TypeError('S3 body requires one entity tag or *.');
  return Object.freeze({ method, ...(input.range === undefined ? {} : { range: input.range }), ...(input.ifNoneMatch === undefined ? {} : { ifNoneMatch: input.ifNoneMatch }) });
}
function bodyRequestHeaders(input) {
  const options = normalizeBodyOptions(input);
  return { ...(options.range === undefined ? {} : { range: options.range }), ...(options.ifNoneMatch === undefined ? {} : { 'if-none-match': options.ifNoneMatch }) };
}
function bodyResponseMetadata(status, headers, options, maximum) {
  const { metadataFromHeaders } = require('./provider.js');
  const metadata = metadataFromHeaders(headers, status === 200 || status === 206);
  if (!metadata) throw new Error('protocol');
  let contentRange;
  for (const [name, value] of headers) if (name.toLowerCase() === 'content-range') {
    if (contentRange !== undefined || value.length > 128) throw new Error('protocol');
    contentRange = value;
  }
  if (status === 304 && options.ifNoneMatch === undefined) throw new Error('protocol');
  if (status === 206) {
    const match = contentRange && /^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/.exec(contentRange);
    const range = options.range && /^bytes=(\d+)-(\d+)$/.exec(options.range);
    if (!match || !range) throw new Error('protocol');
    const [start, end, total] = match.slice(1).map(Number);
    if (!Number.isSafeInteger(total) || start !== Number(range[1]) || end !== Math.min(Number(range[2]), total - 1)
      || start > end || metadata.byteLength !== end - start + 1) throw new Error('protocol');
  } else if (status === 416) {
    const match = contentRange && /^bytes \*\/(0|[1-9][0-9]*)$/.exec(contentRange);
    if (!options.range || !match || !Number.isSafeInteger(Number(match[1])) || Number(options.range.slice(6).split('-')[0]) < Number(match[1])) throw new Error('protocol');
  } else if (contentRange !== undefined) throw new Error('protocol');
  if (options.method !== 'HEAD' && [200, 206].includes(status) && metadata.byteLength > maximum) throw new Error('too-large');
  if (![200, 206, 304, 404, 412, 416].includes(status)) throw new Error('protocol');
  const selected = new Headers();
  if (metadata.byteLength !== undefined && [200, 206].includes(status)) selected.set('content-length', String(metadata.byteLength));
  if (metadata.contentType !== undefined) selected.set('content-type', metadata.contentType);
  if (metadata.etag !== undefined) selected.set('etag', metadata.etag);
  if (contentRange !== undefined) selected.set('content-range', contentRange);
  // No response digest is asserted, including for partial representations.
  return { headers: selected, byteLength: metadata.byteLength, body: options.method !== 'HEAD' && [200, 206].includes(status) };
}
module.exports = { normalizeBodyOptions, bodyRequestHeaders, bodyResponseMetadata };
