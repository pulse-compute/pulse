'use strict';

// Internal planning data. No ledger, provider registration or dispatch authority.
const VERSION = 'pulse.resource-admission.v1';
const PROFILE_VERSION = 'pulse.resource-profile.v1';
const DIMENSIONS = Object.freeze(['handles', 'backingBytes', 'records', 'cleanupSteps', 'effects']);
const EXCLUSIONS = Object.freeze([
  'allocator-metadata', 'application-values', 'engine-and-linear-memory',
  'host-and-network-buffers', 'ledger-storage', 'response-serialization'
]);
const POLICY = Object.freeze({
  identity: 'execution-namespace-slot-generation',
  generationExhaustion: 'reject-before-reuse-never-wrap',
  handleZero: 'valid-provider-value-not-an-empty-slot',
  reservation: 'whole-selection-plus-cleanup-plus-exit-before-acquisition',
  overlap: 'sum-all-claims-no-phase-or-branch-discount',
  unknownOutcome: 'retain-claims-no-retry-or-speculative-refund',
  backingLifetime: 'invocation-no-refund-on-handle-disposal-or-settlement',
  cleanup: 'protected-capacity-original-remaining-deadline-no-new-time',
  admission: 'data-only-not-a-reservation-token',
  budgets: 'existing-value-effect-and-deadline-owners-remain-authoritative'
});
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function invalid(message) {
  const error = new TypeError(message);
  error.code = 'PULSEWASM_RESOURCE_PROFILE_INVALID';
  throw error;
}
function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be a plain record.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) invalid(`${label} must have exactly the declared fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!fields.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(`${label} has an unsupported field or accessor.`);
  }
}
function list(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) invalid(`${label} must be a dense data list.`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid(`${label} must contain data elements.`);
  }
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9.:-]{0,95}$/.test(value)) invalid('Expected a bounded symbolic identifier.');
  return value;
}
function natural(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid('Resource quantities must be nonnegative safe integers.');
  return value === 0 ? 0 : value;
}
function positive(value) {
  if (natural(value) === 0) invalid('A selected count or finite body bound must be positive.');
  return value;
}
function add(a, b) { return natural(a + b); }
function multiply(a, b) { return natural(a * b); }
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function zero() { return Object.fromEntries(DIMENSIONS.map(key => [key, 0])); }
function vector(value) {
  record(value, DIMENSIONS, 'Resource vector');
  return Object.fromEntries(DIMENSIONS.map(key => [key, natural(value[key])]));
}
function plus(left, right, count = 1) {
  return Object.fromEntries(DIMENSIONS.map(key => [key, add(left[key], multiply(right[key], count))]));
}

// Models cumulative payload backing, not RSS or allocator/object overhead.
// All copies remain reserved, including unreachable intermediates. These two
// strategies are mathematical contracts, not assertions about a provider.
function allocation(input) {
  // Inspect kind only after checking its descriptor; never invoke an accessor.
  if (!input || !Object.hasOwn(input, 'kind') || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, 'kind'), 'value')) invalid('Allocation kind must be data.');
  let bytes;
  if (input.kind === 'fixed') {
    record(input, ['id', 'kind', 'bytes', 'copies'], 'Fixed allocation');
    bytes = multiply(natural(input.bytes), positive(input.copies));
  } else if (input.kind === 'chunked-text') {
    record(input, ['id', 'kind', 'maxBytes', 'chunkBytes'], 'Chunked text allocation');
    const bound = positive(input.maxBytes), chunk = positive(input.chunkBytes);
    // At most B positive reads (one byte of progress), plus EOF/overflow/error.
    // Each read allocates C bytes and a four-byte result slot. Decoding uses at
    // most 2B bytes; copied accumulated UTF-16 prefixes total B(B+1) bytes.
    bytes = add(multiply(add(chunk, 4), add(bound, 1)), add(multiply(bound, add(bound, 1)), multiply(2, bound)));
  } else invalid('Unknown or unbounded allocation strategy.');
  return { id: identifier(input.id), kind: input.kind,
    ...(input.kind === 'fixed' ? { bytes: natural(input.bytes), copies: input.copies }
      : { maxBytes: input.maxBytes, chunkBytes: input.chunkBytes }), backingBytes: bytes };
}
function reservation(input, allowCleanup) {
  record(input, ['handles', 'allocations', 'records', 'cleanupSteps'], 'Reservation');
  const demand = zero(), seen = new Set();
  const handles = list(input.handles, 'Handle claims').map(item => {
    record(item, ['namespace', 'count'], 'Handle claim');
    const namespace = identifier(item.namespace), count = positive(item.count);
    if (seen.has(namespace)) invalid('Duplicate handle namespace within reservation.');
    seen.add(namespace);
    demand.handles = add(demand.handles, count);
    return { namespace, count };
  }).sort((a, b) => compare(a.namespace, b.namespace));
  seen.clear();
  const allocations = list(input.allocations, 'Allocations').map(item => {
    const result = allocation(item);
    if (seen.has(result.id)) invalid('Duplicate allocation identity within reservation.');
    seen.add(result.id);
    demand.backingBytes = add(demand.backingBytes, result.backingBytes);
    return result;
  }).sort((a, b) => compare(a.id, b.id));
  // A record for every reserved handle and allocation family, plus declared
  // service metadata. A family retains its whole cumulative backing charge.
  demand.records = add(add(demand.handles, allocations.length), natural(input.records));
  demand.cleanupSteps = natural(input.cleanupSteps);
  if (!allowCleanup && demand.cleanupSteps) invalid('Work cannot spend protected cleanup steps.');
  return { handles, allocations, records: natural(input.records), cleanupSteps: demand.cleanupSteps, demand };
}
function profile(input, realization) {
  record(input, ['version', 'owner', 'operation', 'realization', 'effects', 'work', 'cleanup', 'exclusions'], 'Operation profile');
  if (input.version !== PROFILE_VERSION || input.realization !== realization) invalid('Unsupported profile version or mismatched realization.');
  const work = reservation(input.work, false), cleanup = reservation(input.cleanup, true);
  work.demand.effects = positive(input.effects);
  const exclusions = list(input.exclusions, 'Profile exclusions').map(identifier);
  if (new Set(exclusions).size !== exclusions.length) invalid('Duplicate profile exclusion.');
  return {
    version: PROFILE_VERSION, owner: identifier(input.owner), operation: identifier(input.operation), realization,
    work, cleanup, exclusions: [...new Set([...EXCLUSIONS, ...exclusions])].sort()
  };
}

function createPlan(input) {
  record(input, ['version', 'realization', 'selected', 'exit', 'occupied', 'limits'], 'Resource admission');
  if (input.version !== VERSION) invalid('Unsupported admission version.');
  const realization = identifier(input.realization), seen = new Set();
  const selected = list(input.selected, 'Selected operations').map(item => {
    record(item, ['site', 'count', 'profile'], 'Selected operation');
    const site = identifier(item.site);
    if (seen.has(site)) invalid('Duplicate selected site.');
    seen.add(site);
    return { site, count: positive(item.count), profile: profile(item.profile, realization) };
  }).sort((a, b) => compare(a.site, b.site));
  const exit = reservation(input.exit, true), occupied = vector(input.occupied), limits = vector(input.limits);
  let work = zero(), cleanup = zero();
  const namespaces = new Map();
  function collect(reserve, count) {
    for (const item of reserve.handles) namespaces.set(item.namespace, add(namespaces.get(item.namespace) || 0, multiply(item.count, count)));
  }
  for (const item of selected) {
    work = plus(work, item.profile.work.demand, item.count);
    cleanup = plus(cleanup, item.profile.cleanup.demand, item.count);
    collect(item.profile.work, item.count); collect(item.profile.cleanup, item.count);
  }
  collect(exit, 1);
  const required = plus(plus(work, cleanup), exit.demand), total = plus(occupied, required);
  const shortages = DIMENSIONS.filter(key => total[key] > limits[key]).map(dimension => ({
    dimension, required: required[dimension], occupied: occupied[dimension], limit: limits[dimension],
    missing: total[dimension] - limits[dimension]
  }));
  return frozen({
    version: VERSION, realization, selected, exit, partitions: { work, cleanup, exit: exit.demand },
    handlesByNamespace: [...namespaces].sort(([a], [b]) => compare(a, b)).map(([namespace, count]) => ({ namespace, count })),
    required, occupied, total, limits, admitted: shortages.length === 0, shortages,
    exclusions: [...new Set([...EXCLUSIONS, ...selected.flatMap(item => item.profile.exclusions)])].sort()
  });
}

module.exports = Object.freeze({ VERSION, PROFILE_VERSION, DIMENSIONS, EXCLUSIONS, POLICY, createPlan });
