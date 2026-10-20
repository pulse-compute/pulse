'use strict';
const { PulseRuntimeContractError } = require('./errors');
const states = new WeakMap();
function createNumericWorkspaceContext(execution) {
  let state = states.get(execution);
  if (!state) { state = { count: 0, allocations: [] }; states.set(execution, state); }
  const fail = () => { throw new PulseRuntimeContractError('PULSE_NUMERIC_WORKSPACE_INVALID', 'Numeric workspace requires bounded, execution-owned finite numeric cells.'); };
  function index(key, capacity) {
    execution.checkOpen();
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) return fail();
    const value = Number(key);
    if (!Number.isSafeInteger(value) || value >= capacity) return fail();
    return value;
  }
  return Object.freeze({ numbers(capacity) {
    execution.checkOpen();
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024 || state.count >= 4) return fail();
    state.count++;
    const allocation = { cells: new Float64Array(capacity) };
    state.allocations.push(allocation);
    return new Proxy(Object.create(null), {
      get(_target, key) { execution.checkOpen(); return key === 'length' ? capacity : allocation.cells[index(key, capacity)]; },
      set(_target, key, value) { const at = index(key, capacity); if (typeof value !== 'number' || !Number.isFinite(value)) return fail(); allocation.cells[at] = value; return true; },
      ownKeys: fail, defineProperty: fail, deleteProperty: fail, setPrototypeOf: fail
    });
  } });
}
// Callable frames can release backing stores even when a trusted host retains
// an invalidated view. Accounting is not refunded and the execution stays closed.
function closeNumericWorkspaceContext(execution) {
  const state = states.get(execution);
  if (!state) return;
  for (const allocation of state.allocations) { allocation.cells.fill(0); allocation.cells = undefined; }
  state.allocations.length = 0;
}
module.exports = { createNumericWorkspaceContext, closeNumericWorkspaceContext };
