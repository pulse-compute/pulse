'use strict';

const { admission } = require('@pulse-compute/wasm-contracts/schema-json/contracts');
const { normalizeJsonAdmissionLimits, JsonAdmissionBudget, JsonTextAdmission, JSON_ADMISSION_FAILURES } = admission;

function jsonAdmissionFailure(budget, offset = -1) {
  const error = new TypeError(`JSON admission failed: ${JSON_ADMISSION_FAILURES[budget.failure]}.`);
  error.code = 'PULSEWASM_JSON_ADMISSION_FAILED';
  error.detail = Object.freeze({ reason: JSON_ADMISSION_FAILURES[budget.failure], offset });
  throw error;
}

function jsonAdmissionSummary(budget) {
  return { nodes: budget.nodes, depth: budget.depth, jsonBytes: budget.jsonBytes };
}

function admitJsonText(text, input, duplicatePolicy = 'allow') {
  const limits = normalizeJsonAdmissionLimits(input);
  if (typeof text !== 'string') throw new TypeError('JSON admission text must be a string.');
  const mode = ['allow', 'reject', 'report'].indexOf(duplicatePolicy);
  if (mode < 0) throw new TypeError('Unknown JSON duplicate policy.');
  const scanner = new JsonTextAdmission(text, limits, mode);
  if (!scanner.scan()) jsonAdmissionFailure(scanner, scanner.offset);
  const duplicates = scanner.duplicateObjects.map((objectStart, index) => Object.freeze({
    objectStart, keyStart: scanner.duplicateKeys[index], firstKeyStart: scanner.duplicateFirstKeys[index]
  }));
  return Object.freeze({ ...jsonAdmissionSummary(scanner), textBytes: scanner.textBytes, duplicates: Object.freeze(duplicates) });
}

// The continuation runs only after admission. Existing schemas do not select
// this internal seam; it establishes ordering for subsequent codec integration.
function withAdmittedJsonText(text, limits, materialize, duplicatePolicy = 'allow') {
  const result = admitJsonText(text, limits, duplicatePolicy);
  return materialize(text, result);
}

function admitJsonValue(root, input) {
  const limits = normalizeJsonAdmissionLimits(input);
  return inspectJsonValue(root, limits);
}

// A generated schema codec uses normalized limits and requests one detached,
// immutable snapshot. Admission and copying share a traversal, so no second
// read of an application property can replace an already-admitted child.
function inspectJsonValue(root, limits, project = false) {
  const budget = new JsonAdmissionBudget(limits);
  const active = new Set();
  const stack = [];
  const fail = reason => { budget.fail(reason); jsonAdmissionFailure(budget); };
  const bytes = size => { if (!budget.addBytes(size)) jsonAdmissionFailure(budget); };
  function string(text, key) {
    if (!budget.stringBytes(text, key)) jsonAdmissionFailure(budget);
  }
  function value(item) {
    const container = item !== null && typeof item === 'object';
    if (!budget.node(stack.length + (container ? 1 : 0))) jsonAdmissionFailure(budget);
    if (!container) {
      if (item === null) bytes(4);
      else if (typeof item === 'boolean') bytes(item ? 4 : 5);
      else if (typeof item === 'string') string(item, false);
      else if (typeof item === 'number') { if (!Number.isFinite(item)) fail(11); bytes(24); }
      else fail(12);
      return item;
    }
    if (active.has(item)) fail(13);
    const array = Array.isArray(item);
    const proto = Object.getPrototypeOf(item);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail(12);
    if (array && item.length > limits.maxArrayItems) fail(6);
    // JS has no incremental own-key reflection primitive. This enumerates the
    // already-created input, then bounds our traversal stack before retaining
    // frames or reading descriptors. It does not construct a projected object.
    const keys = Reflect.ownKeys(item);
    if (array) {
      if (keys.length !== item.length + 1) fail(12); // dense, no extra properties
    } else if (keys.length > limits.maxObjectMembers) fail(5);
    if (keys.some(key => typeof key !== 'string')) fail(12);
    bytes(2); // opening and closing delimiters
    active.add(item);
    const output = project ? (array ? [] : {}) : null;
    stack.push({ item, output, array, keys, index: 0, count: array ? item.length : keys.length });
    return output;
  }
  const output = value(root);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.count) {
      if (project) Object.freeze(frame.output);
      active.delete(frame.item); stack.pop(); continue;
    }
    const index = frame.index++;
    const key = frame.array ? String(index) : frame.keys[index];
    if (index > 0) bytes(1);
    if (!frame.array) { string(key, true); bytes(1); }
    const descriptor = Object.getOwnPropertyDescriptor(frame.item, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(12);
    const child = value(descriptor.value);
    if (project) Object.defineProperty(frame.output, key, { value: child, enumerable: true });
  }
  return Object.freeze({ ...jsonAdmissionSummary(budget), ...(project ? { value: output } : {}) });
}

function javascriptJsonAdmissionSource() {
  const classes = [admission.JsonAdmissionBudget, admission.JsonAdmissionFrame, admission.JsonTextAdmission];
  return (`const JSON_ADMISSION_FAILURES = ${JSON.stringify(JSON_ADMISSION_FAILURES)};\n`
    + [...classes, jsonAdmissionFailure, jsonAdmissionSummary, inspectJsonValue].map(value => value.toString()).join('\n'))
    .replace(/\b(JSON_ADMISSION_FAILURES|JsonAdmissionBudget|JsonAdmissionFrame|JsonTextAdmission|jsonAdmissionFailure|jsonAdmissionSummary|inspectJsonValue)\b/g,
      name => '__pulse_schema_' + name);
}

module.exports = { admitJsonText, withAdmittedJsonText, admitJsonValue, javascriptJsonAdmissionSource };
