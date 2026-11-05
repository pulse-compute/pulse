'use strict';
const { S3_LIMITS } = require('@pulse-compute/wasm-contracts/s3/contracts');
const bytes = text => new TextEncoder().encode(text).length;
const scalar = (text, max) => typeof text === 'string' && text.length <= max && text.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f]/u.test(text) && bytes(text) <= max;
function listOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
  for (const name of Reflect.ownKeys(input)) {
    const d = Object.getOwnPropertyDescriptor(input, name);
    if (!['prefix', 'continuationToken', 'maxKeys'].includes(name) || !d.enumerable || !Object.hasOwn(d, 'value')) return null;
  }
  const prefix = input.prefix === undefined ? '' : input.prefix;
  const continuationToken = input.continuationToken === undefined ? '' : input.continuationToken;
  const maxKeys = input.maxKeys === undefined ? 100 : input.maxKeys;
  if (!scalar(prefix, S3_LIMITS.keyBytes) || !scalar(continuationToken, S3_LIMITS.tokenBytes) || !Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > S3_LIMITS.listKeys) return null;
  return Object.freeze({ prefix, continuationToken, maxKeys });
}
function record(value, fields) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => { const d = Object.getOwnPropertyDescriptor(value, key); return fields.includes(key) && d.enumerable && Object.hasOwn(d, 'value'); });
}
const encode = text => encodeURIComponent(text).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function listQuery(options) {
  return (options.continuationToken ? 'continuation-token=' + encode(options.continuationToken) + '&' : '')
    + 'encoding-type=url&list-type=2&max-keys=' + options.maxKeys + '&prefix=' + encode(options.prefix);
}
// Restricted, bounded S3 XML parser: no DTD, external entities, CDATA or processing
// instructions. Parse the entire document before accepting any page contents.
function decodeXml(value) {
  let output = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c !== '&') { output += c; continue; }
    const end = value.indexOf(';', i + 1); if (end < 0 || end - i > 12) throw Error('protocol');
    const name = value.slice(i + 1, end), known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(known, name)) output += known[name];
    else {
      if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) throw Error('protocol');
      const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (!(code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff)) throw Error('protocol');
      output += String.fromCodePoint(code);
    }
    i = end;
  }
  return output;
}
function xmlTree(text) {
  if (typeof text !== 'string' || !text.isWellFormed() || bytes(text) > S3_LIMITS.listBytes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text)) throw Error('protocol');
  text = text.replace(/\r\n?/g, '\n');
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (text.slice(i, i + 5) === '<?xml') {
    const end = text.indexOf('?>', i); if (end < 0 || !/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/.test(text.slice(i, end + 2))) throw Error('protocol'); i = end + 2;
  }
  const stack = []; let root, count = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i), end = next < 0 ? text.length : next;
      const raw = text.slice(i, end); if (raw.includes(']]>')) throw Error('protocol');
      const value = decodeXml(raw);
      if (stack.length) stack[stack.length - 1].text += value;
      else if (value.trim()) throw Error('protocol');
      i = end; continue;
    }
    if (text.slice(i, i + 4) === '<!--') {
      const end = text.indexOf('-->', i + 4); if (end < 0 || (text.slice(i + 4, end).includes('--') || text.slice(i + 4, end).endsWith('-'))) throw Error('protocol'); i = end + 3; continue;
    }
    const end = text.indexOf('>', i + 1); if (end < 0) throw Error('protocol');
    const tag = text.slice(i + 1, end); i = end + 1;
    if (tag[0] === '/') { const name = tag.slice(1).trimEnd(); if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || !stack.length || stack.pop().name !== name) throw Error('protocol'); continue; }
    const m = /^([A-Za-z][A-Za-z0-9]*)(\s+xmlns=(?:"http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/"|'http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/'))?\s*(\/)?$/.exec(tag);
    if (!m || (m[2] && stack.length) || ++count > 16016 || stack.length >= 8) throw Error('protocol');
    const node = { name: m[1], text: '', children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node); else { if (root) throw Error('protocol'); root = node; }
    if (!m[3]) stack.push(node);
  }
  if (stack.length || !root || root.name !== 'ListBucketResult' || root.text.trim()) throw Error('protocol');
  return root;
}
function field(node, name, required = true) {
  const found = node.children.filter(c => c.name === name);
  if (found.length > 1 || required && found.length !== 1 || found.some(c => c.children.length)) throw Error('protocol');
  return found.length ? found[0].text : undefined;
}
function decimal(text) { if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(Number(text))) throw Error('protocol'); return Number(text); }
function parseList(text, options, bucket) {
  try {
    const root = xmlTree(text);
    if (field(root, 'Name') !== bucket || field(root, 'EncodingType') !== 'url' || decodeURIComponent(field(root, 'Prefix')) !== options.prefix
      || decimal(field(root, 'MaxKeys')) !== options.maxKeys || root.children.some(c => c.name === 'CommonPrefixes')) return null;
    const truncated = field(root, 'IsTruncated'), token = field(root, 'NextContinuationToken', false);
    if (!['true', 'false'].includes(truncated) || (truncated === 'true' ? !scalar(token, S3_LIMITS.tokenBytes) || !token.length || token === options.continuationToken : token !== undefined)) return null;
    const entries = root.children.filter(c => c.name === 'Contents').map(node => {
      if (node.text.trim()) throw Error('protocol');
      const key = decodeURIComponent(field(node, 'Key')), byteLength = decimal(field(node, 'Size')), etag = field(node, 'ETag', false);
      if (!scalar(key, S3_LIMITS.keyBytes) || !key.length || !key.startsWith(options.prefix) || etag !== undefined && (!scalar(etag, S3_LIMITS.metadataBytes) || !etag.length)) throw Error('protocol');
      return Object.freeze({ key, byteLength, ...(etag === undefined ? {} : { etag }) });
    });
    if (entries.length > options.maxKeys || decimal(field(root, 'KeyCount')) !== entries.length || new Set(entries.map(e => e.key)).size !== entries.length) return null;
    return Object.freeze({ status: 'listed', entries: Object.freeze(entries), isTruncated: truncated === 'true', ...(token === undefined ? {} : { nextContinuationToken: token }) });
  } catch { return null; }
}
function normalizeListResult(value) {
  const resultFields = ['status', 'entries', 'isTruncated', 'nextContinuationToken'];
  if (!record(value, resultFields) || value.status !== 'listed' || !Array.isArray(value.entries) || value.entries.length > S3_LIMITS.listKeys || typeof value.isTruncated !== 'boolean') throw new TypeError('Invalid S3 list result.');
  const token = value.nextContinuationToken;
  if (value.isTruncated ? !scalar(token, S3_LIMITS.tokenBytes) || !token.length : token !== undefined) throw new TypeError('Invalid S3 list cursor.');
  if (Reflect.ownKeys(value.entries).length !== value.entries.length + 1 || !Object.keys(value.entries).every((key, i) => key === String(i) && Object.hasOwn(Object.getOwnPropertyDescriptor(value.entries, key), 'value'))) throw new TypeError('Invalid S3 list entries.');
  const entries = value.entries.map(e => {
    if (!record(e, ['key', 'byteLength', 'etag']) || !scalar(e.key, S3_LIMITS.keyBytes) || !e.key.length || !Number.isSafeInteger(e.byteLength) || e.byteLength < 0 || e.etag !== undefined && (!scalar(e.etag, S3_LIMITS.metadataBytes) || !e.etag.length)) throw new TypeError('Invalid S3 list entry.');
    return Object.freeze({ ...e });
  });
  if (new Set(entries.map(e => e.key)).size !== entries.length) throw new TypeError('Duplicate S3 list entries.');
  return Object.freeze({ ...value, entries: Object.freeze(entries) });
}
module.exports = { listOptions, listQuery, parseList, normalizeListResult };
