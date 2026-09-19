'use strict';

const { scalarRecordStringBytes } = require('@pulse-compute/wasm-contracts/schema-json/registry');

// These functions are embedded into emitted JavaScript codecs. They use only
// their arguments, standard JavaScript, and the shared string-sizing function.
function projectScalarRecord(value, limits, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail(null, 'scalar-record', value === null ? 'null' : typeof value);
  }
  const keys = Object.getOwnPropertyNames(value).sort();
  if (keys.length > limits.maxKeys) fail(null, 'at-most-' + limits.maxKeys + '-keys', 'too-many-keys');
  if (Object.getOwnPropertySymbols(value).length) fail(null, 'string-keys', 'symbol');
  const output = {};
  let bytes = 2;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key.length > limits.maxKeyLength) fail(key, 'bounded-key', 'key-too-long');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(key, 'data-property', 'accessor');
    const item = descriptor.value;
    let size;
    if (item === null) size = 4;
    else if (typeof item === 'string') {
      if (item.length > limits.maxStringLength) fail(key, 'bounded-string', 'string-too-long');
      size = scalarRecordStringBytes(item);
    } else if (typeof item === 'boolean') size = item ? 4 : 5;
    else if (typeof item === 'number' && Number.isFinite(item)) size = limits.numberBytes;
    else fail(key, 'string|finite-number|boolean|null', Array.isArray(item) ? 'array' : typeof item);
    bytes += (index === 0 ? 0 : 1) + scalarRecordStringBytes(key) + 1 + size;
    if (bytes > limits.maxBytes) fail(null, 'bounded-scalar-record', 'byte-budget-exceeded');
    Object.defineProperty(output, key, { enumerable: true, value: item });
  }
  return Object.freeze(output);
}

// JSON.parse still owns syntax. Scan only schema-selected records in valid
// JSON before exposing values; ordinary object fields keep last-member-wins.
function validateScalarRecordText(text, root, fail) {
  function space(i) { while (i < text.length && text.charCodeAt(i) <= 32) i++; return i; }
  function stringEnd(i) {
    for (i++; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 92) i++;
      else if (c === 34) return i + 1;
    }
    return text.length;
  }
  function end(i) {
    i = space(i);
    if (text[i] === '"') return stringEnd(i);
    if (text[i] !== '{' && text[i] !== '[') {
      while (i < text.length && !',]} \t\r\n'.includes(text[i])) i++;
      return i;
    }
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '"') i = stringEnd(i) - 1;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) return i + 1;
    }
    return text.length;
  }
  function visit(node, start, path) {
    start = space(start);
    if (node.kind === 'nullable') { visit(node.value, start, path); return; }
    if (node.kind === 'array' && text[start] === '[') {
      let i = space(start + 1), index = 0;
      while (i < text.length && text[i] !== ']') {
        visit(node.element, i, path + '/' + index++);
        i = space(end(i));
        if (text[i] !== ',') break;
        i = space(i + 1);
      }
    } else if ((node.kind === 'object' || node.kind === 'scalar-record') && text[start] === '{') {
      const names = new Set(), fields = new Map();
      let i = space(start + 1);
      while (i < text.length && text[i] !== '}') {
        const keyEnd = stringEnd(i), key = JSON.parse(text.slice(i, keyEnd));
        i = space(space(keyEnd) + 1);
        if (node.kind === 'scalar-record') {
          if (names.has(key)) fail(path, 'unique-keys', 'duplicate-key');
          names.add(key);
          if (names.size > node.limits.maxKeys) fail(path, 'bounded-scalar-record', 'too-many-keys');
        } else {
          const field = node.fields.find(field => field.name === key);
          if (field) fields.set(key, { node: field.value, start: i });
        }
        i = space(end(i));
        if (text[i] !== ',') break;
        i = space(i + 1);
      }
      for (const [key, field] of fields) visit(field.node, field.start, path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'));
    }
  }
  visit(root, 0, '');
}

module.exports = { projectScalarRecord, validateScalarRecordText };
