'use strict';

const execution = require('./execution-lifecycle.js');
const http = require('../host/http-lifecycle.js');

// Internal data protocol, not package registration or an executable hook API.
const VERSION = 'pulse.lifecycle-plan.v1';
const BINDINGS_VERSION = 'pulse.lifecycle-bindings.v1';
const IDENTIFIER = /^[a-z0-9][a-z0-9.:-]{0,95}$/;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function invalid(message) {
  const error = new TypeError(message);
  error.code = 'PULSEWASM_EXECUTION_LIFECYCLE_INVALID';
  throw error;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Trusted build metadata, but reject accessors, symbols, extra fields and
// non-records rather than silently losing executable or misspelled input.
function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(`${label} must be a plain record.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!fields.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(`${label} has an unsupported field or accessor.`);
    }
  }
}

function list(value, label) {
  if (!Array.isArray(value)) invalid(`${label} must be a list.`);
  // Reject holes and custom properties; every element must be validated.
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid(`${label} must be a dense list.`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid(`${label} must contain data elements.`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalid(`${label} must be a bounded symbolic identifier.`);
  return value;
}

function roles(input, expected, label) {
  record(input, expected, label);
  if (Object.keys(input).length !== expected.length) invalid(`${label} must bind every semantic role exactly once.`);
  return expected.map(role => ({ role, binding: identifier(input[role], `${label}.${role}`) }));
}

function pointFor(points, name) {
  if (typeof name !== 'string' || !Object.hasOwn(points, name)) invalid('Unknown or unselected lifecycle point.');
  return points[name];
}

function createPlan(input) {
  record(input, ['bindings', 'contributions'], 'Lifecycle plan input');
  const bindings = input.bindings;
  record(bindings, ['version', 'executionVersion', 'httpVersion', 'sites'], 'Lifecycle bindings');
  if (bindings.version !== BINDINGS_VERSION || bindings.executionVersion !== execution.VERSION) {
    invalid('Unsupported lifecycle binding or execution version.');
  }
  // HTTP is selected only by its exact version, never by provider identity.
  if (Object.hasOwn(bindings, 'httpVersion') && bindings.httpVersion !== http.VERSION) {
    invalid('Unsupported HTTP lifecycle version.');
  }
  const points = bindings.httpVersion ? { ...execution.POINTS, ...http.POINTS } : execution.POINTS;
  const available = new Set();
  const siteIds = new Set();
  const sites = list(bindings.sites, 'Lifecycle sites').map(site => {
    record(site, ['id', 'points'], 'Lifecycle site');
    const id = identifier(site.id, 'Lifecycle site ID');
    if (siteIds.has(id)) invalid('Lifecycle site IDs must be unique.');
    siteIds.add(id);
    const names = new Set();
    const bound = list(site.points, 'Lifecycle site points').map(binding => {
      record(binding, ['point', 'parameters', 'afterParameters', 'reject', 'onClaim'], 'Lifecycle point binding');
      const semantic = pointFor(points, binding.point);
      if (names.has(binding.point)) invalid('A lifecycle point may be bound only once at a site.');
      names.add(binding.point);
      available.add(binding.point);
      const parameters = roles(binding.parameters, semantic.parameters, 'Lifecycle parameters');
      const around = semantic.kind === 'around';
      const afterParameters = around ? roles(binding.afterParameters, semantic.afterParameters, 'Lifecycle after parameters') : [];
      if (!around && Object.hasOwn(binding, 'afterParameters')) invalid('Only around points have after parameters.');
      const action = ['guard', 'predicate'].includes(semantic.kind) ? 'reject' : semantic.kind === 'claim' ? 'onClaim' : null;
      for (const field of ['reject', 'onClaim']) {
        if (field === action) identifier(binding[field], `Lifecycle ${field} action`);
        else if (Object.hasOwn(binding, field)) invalid('Lifecycle action does not match the composition kind.');
      }
      return {
        point: binding.point, kind: semantic.kind, parameters, afterParameters,
        ...(action ? { [action]: binding[action] } : {})
      };
    });
    if (!bound.length) invalid('A lifecycle site must bind at least one point.');
    // Site point order is explicit execution order, not object enumeration or
    // source insertion order. A response-error claim cannot outrun its fence.
    for (const [outer, semantic] of Object.entries(points)) {
      for (const inner of semantic.dominates || []) {
        const innerIndex = bound.findIndex(item => item.point === inner);
        const outerIndex = bound.findIndex(item => item.point === outer);
        if (innerIndex >= 0 && (outerIndex < 0 || outerIndex >= innerIndex)) {
          invalid('Lifecycle site order violates the response-authority fence.');
        }
      }
    }
    return { id, points: bound };
  }).sort((a, b) => compare(a.id, b.id));

  const byPoint = new Map();
  for (const item of list(input.contributions, 'Lifecycle contributions')) {
    record(item, ['point', 'owner', 'order'], 'Lifecycle contribution');
    pointFor(points, item.point);
    identifier(item.owner, 'Lifecycle contribution owner');
    if (!Number.isSafeInteger(item.order)) invalid('Lifecycle contribution order must be a safe integer.');
    if (!available.has(item.point)) invalid('Lifecycle contribution has no bound site.');
    const items = byPoint.get(item.point) || [];
    if (items.some(other => other.owner === item.owner)) invalid('An owner may contribute to a lifecycle point once.');
    if (items.some(other => other.order === item.order)) invalid('Lifecycle contributions on a point need distinct orders.');
    items.push({ owner: item.owner, order: item.order === 0 ? 0 : item.order });
    byPoint.set(item.point, items);
  }
  for (const items of byPoint.values()) items.sort((a, b) => compare(a.order, b.order));
  for (const [outer, semantic] of Object.entries(points)) {
    for (const inner of semantic.dominates || []) {
      if (byPoint.has(inner) && !byPoint.has(outer)) invalid('An active response-error claim requires an active authority fence.');
    }
  }

  return freeze({
    version: VERSION,
    executionVersion: execution.VERSION,
    invocationVersion: execution.INVOCATION.version,
    httpVersion: bindings.httpVersion || null,
    // Unused bindings emit no dispatch sites. Adapters must emit nothing for
    // this empty list; the planner itself cannot establish artifact identity.
    sites: sites.flatMap(site => {
      const active = site.points.filter(binding => byPoint.has(binding.point)).map(binding => {
        const semantic = points[binding.point];
        const contributions = byPoint.get(binding.point).map(item => ({ ...item }));
        return {
          ...binding,
          composition: { ...execution.COMPOSITION[semantic.kind] },
          ...(semantic.rejection ? { rejection: semantic.rejection } : {}),
          ...(semantic.runsOn ? { runsOn: semantic.runsOn } : {}),
          contributions,
          ...(semantic.kind === 'around' ? { after: [...contributions].reverse() } : {})
        };
      });
      return active.length ? [{ id: site.id, points: active }] : [];
    })
  });
}

module.exports = Object.freeze({ VERSION, BINDINGS_VERSION, createPlan });
