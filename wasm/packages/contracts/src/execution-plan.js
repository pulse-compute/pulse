'use strict';

const EXECUTION_PLAN_VERSION = 'pulsewasm.execution-plan.v1';

const ENTRY_KIND_CODES = Object.freeze({
  unknown: 0,
  use: 1,
  route: 2,
  error: 3,
  channel: 4,
  lifecycle: 5,
  mount: 6
});

const EXECUTION_POLICY = Object.freeze({
  phase: '8E',
  sourceOfTruth: 'router-tree.json + dispatch-table.json + path-table.json',
  model: 'ordered entry scanner with static continuation indices',
  next: Object.freeze({
    normal: 'next() resumes normal routing at entry.nextIndex',
    error: 'next(err) enters error mode at entry.nextIndex with activeError = err',
    representation: 'static nextIndex / childStartIndex / parentContinueIndex integers, not JS closures'
  }),
  errors: Object.freeze({
    mode: 'runtime parity ordered error scan',
    transition: 'next(err) or host/runtime error enters error mode',
    handlerNext: 'error next() clears activeError and resumes normal scan; error next(err2) continues error scan with err2',
    noNext: 'error handler that returns no result and does not call next continues bubbling to later error entries'
  }),
  routeHandlers: Object.freeze({
    terminal: false,
    mayCallNext: true,
    noNext: 'handler that returns no result and does not call next halts the scan'
  }),
  codegen: 'metadata artifact; generated harness may execute this plan, but Phase 8E still does not emit Wasm'
});

module.exports = {
  EXECUTION_PLAN_VERSION,
  EXECUTION_POLICY,
  ENTRY_KIND_CODES
};
