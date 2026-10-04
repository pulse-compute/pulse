'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');

const JSON_ADMISSION_VERSION = 'pulse.json-admission.v1';
const JSON_LIMIT_FIELDS = Object.freeze([
  'maxTextBytes', 'maxDepth', 'maxNodes', 'maxObjectMembers',
  'maxArrayItems', 'maxKeyLength', 'maxStringLength', 'maxJsonBytes'
]);
const JSON_ADMISSION_FAILURES = Object.freeze([
  'none', 'malformed', 'text-bytes', 'depth', 'nodes', 'object-members',
  'array-items', 'key-length', 'string-length', 'json-bytes',
  'duplicate-key', 'non-finite-number', 'unsupported-value', 'cycle'
]);

// No application defaults in this internal foundation. All counters fit i32;
// additions check remaining capacity before adding, including in generated AS.
function normalizeJsonAdmissionLimits(input) {
  const invalid = () => {
    const error = new TypeError('JSON admission requires all eight positive i32 limits as own data properties.');
    error.code = 'PULSEWASM_JSON_LIMITS_INVALID';
    throw error;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== JSON_LIMIT_FIELDS.length || keys.some(key => !JSON_LIMIT_FIELDS.includes(key))) invalid();
  const limits = {};
  for (const key of JSON_LIMIT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    const value = descriptor.value;
    if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff) invalid();
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function jsonAdmissionIdentity(input) {
  const limits = normalizeJsonAdmissionLimits(input);
  return Object.freeze({ version: JSON_ADMISSION_VERSION, limits,
    hash: sha256Hex(stableStringify({ version: JSON_ADMISSION_VERSION, limits })) });
}

// These classes are executable reference semantics shared with Native codegen.
// Type comments are erased by JavaScript and realized by the AS generator.
class JsonAdmissionLimits {
  maxTextBytes/*: i32 */ = 0;
  maxDepth/*: i32 */ = 0;
  maxNodes/*: i32 */ = 0;
  maxObjectMembers/*: i32 */ = 0;
  maxArrayItems/*: i32 */ = 0;
  maxKeyLength/*: i32 */ = 0;
  maxStringLength/*: i32 */ = 0;
  maxJsonBytes/*: i32 */ = 0;
}

class JsonAdmissionBudget {
  limits/*: JsonAdmissionLimits */;
  failure/*: i32 */ = 0;
  nodes/*: i32 */ = 0;
  depth/*: i32 */ = 0;
  jsonBytes/*: i32 */ = 0;
  constructor(limits/*: JsonAdmissionLimits */) { this.limits = limits; }
  fail(reason/*: i32 */)/*: bool */ {
    if (this.failure === 0) this.failure = reason;
    return false;
  }
  addBytes(amount/*: i32 */)/*: bool */ {
    if (this.failure !== 0) return false;
    if (amount < 0 || amount > this.limits.maxJsonBytes - this.jsonBytes) return this.fail(9);
    this.jsonBytes += amount;
    return true;
  }
  node(containerDepth/*: i32 */)/*: bool */ {
    if (this.failure !== 0) return false;
    if (this.nodes >= this.limits.maxNodes) return this.fail(4);
    this.nodes++;
    if (containerDepth > this.limits.maxDepth) return this.fail(3);
    if (containerDepth > this.depth) this.depth = containerDepth;
    return true;
  }
  stringBytes(text/*: string */, key/*: bool */)/*: bool */ {
    if (text.length > (key ? this.limits.maxKeyLength : this.limits.maxStringLength)) return this.fail(key ? 7 : 8);
    if (!this.addBytes(2)) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let size = c < 32 ? 6 : c === 34 || c === 92 ? 2 : c < 128 ? 1 : c < 2048 ? 2 : 3;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size = 4; i++; }
      else if (c >= 0xd800 && c <= 0xdfff) size = 6;
      if (!this.addBytes(size)) return false;
    }
    return true;
  }
}

module.exports = { JSON_ADMISSION_VERSION, JSON_LIMIT_FIELDS, JSON_ADMISSION_FAILURES,
  normalizeJsonAdmissionLimits, jsonAdmissionIdentity, JsonAdmissionLimits, JsonAdmissionBudget };
