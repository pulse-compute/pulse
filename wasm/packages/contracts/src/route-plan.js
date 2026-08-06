'use strict';

const ROUTE_PLAN_VERSION = 'pulsewasm.route-plan.v4';
const ROUTE_STABLE_INPUT_VERSION = 'pulsewasm.route-stable-input.v2';

const ROUTE_STABLE_ID_POLICY = Object.freeze({
  algorithm: 'sha256',
  prefix: 'route',
  input: 'method + normalized path + params + handler IDs + inherited middleware/error/lifecycle handler IDs + channel identity',
  version: ROUTE_STABLE_INPUT_VERSION
});

const ROUTE_RUNTIME_ID_POLICY = Object.freeze({
  field: 'runtimeId',
  dense: true,
  startsAt: 0,
  assignment: 'deterministic flattened route order'
});

const ROUTE_ID_COMPATIBILITY_POLICY = Object.freeze({
  id: 'alias of runtimeId for Phase 1 compatibility'
});

const ROUTE_ID_POLICY = Object.freeze({
  stable: ROUTE_STABLE_ID_POLICY,
  runtime: ROUTE_RUNTIME_ID_POLICY,
  compatibility: ROUTE_ID_COMPATIBILITY_POLICY
});

const ROUTE_PLAN_POLICY = Object.freeze({
  version: ROUTE_PLAN_VERSION,
  idPolicy: ROUTE_ID_POLICY
});

module.exports = {
  ROUTE_PLAN_VERSION,
  ROUTE_STABLE_INPUT_VERSION,
  ROUTE_STABLE_ID_POLICY,
  ROUTE_RUNTIME_ID_POLICY,
  ROUTE_ID_COMPATIBILITY_POLICY,
  ROUTE_ID_POLICY,
  ROUTE_PLAN_POLICY
};
