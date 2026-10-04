'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const budgets = new WeakSet();

function normalizeRequestDuration(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 30000) {
    throw new PulseRuntimeContractError('PULSE_REQUEST_DURATION_INVALID', 'Request maxDurationMs must be an integer from 1 through 30000.');
  }
  return value;
}

// Host-only authority. One budget is passed through adapters; nested calls must
// never restart it. Wall time and inbound headers are deliberately not inputs.
function createRequestBudget(options = {}) {
  if (options.requestBudget !== undefined) {
    if (!budgets.has(options.requestBudget)) throw new TypeError('Invalid host request budget.');
    return options.requestBudget;
  }
  const duration = normalizeRequestDuration(options.maxDurationMs);
  const clock = options.requestClock || {
    now: () => performance.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: handle => clearTimeout(handle)
  };
  const controller = new AbortController();
  let timer, closed = false, last = -Infinity;
  const read = () => {
    let value;
    try { value = clock.now(); } catch (_) { value = NaN; }
    if (!Number.isFinite(value) || value < last) {
      controller.abort(new PulseRuntimeContractError('PULSE_REQUEST_CLOCK_INVALID', 'Request monotonic clock failed or regressed.'));
      controller.signal.throwIfAborted();
    }
    last = value;
    return value;
  };
  const deadline = duration === undefined ? undefined : read() + duration;
  const expire = () => controller.abort(new PulseRuntimeContractError('PULSE_REQUEST_DEADLINE_EXCEEDED', 'Pulse request exceeded its total execution deadline.'));
  const signals = [...new Set([options.signal, options.requestSignal].filter(Boolean))];
  const listeners = new Set(signals.map(signal => {
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener('abort', abort);
  }));
  const budget = Object.freeze({
    signal: controller.signal,
    deadlineMonotonicMs: deadline,
    clock,
    check() {
      if (closed) throw new PulseRuntimeContractError('PULSE_REQUEST_EXECUTION_CLOSED', 'Pulse request execution is closed.');
      if (!controller.signal.aborted && deadline !== undefined && read() >= deadline) expire();
      controller.signal.throwIfAborted();
    },
    onAbort(callback) {
      if (controller.signal.aborted || closed) { callback(); return () => {}; }
      const remove = () => {
        controller.signal.removeEventListener('abort', callback);
        listeners.delete(remove);
      };
      listeners.add(remove);
      controller.signal.addEventListener('abort', callback, { once: true });
      return remove;
    },
    remainingMs() { budget.check(); return deadline === undefined ? Infinity : Math.max(0, deadline - last); },
    race(value) {
      // Always observe the pending work, including an already-expired request.
      const pending = Promise.resolve(value);
      return new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(controller.signal.reason); };
        controller.signal.addEventListener('abort', abort, { once: true });
        const cleanup = () => controller.signal.removeEventListener('abort', abort);
        pending.then(result => {
          cleanup();
          try { budget.check(); resolve(result); } catch (error) { reject(error); }
        }, error => { cleanup(); reject(error); });
        try { budget.check(); } catch (error) { cleanup(); reject(error); }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clock.clearTimeout(timer);
      for (const remove of listeners) remove();
      listeners.clear();
    }
  });
  budgets.add(budget);
  if (deadline !== undefined && !controller.signal.aborted) {
    const schedule = () => {
      try {
        budget.check();
        timer = clock.setTimeout(schedule, budget.remainingMs());
      } catch (_) { /* check has already revoked execution authority */ }
    };
    timer = clock.setTimeout(schedule, duration);
  }
  return budget;
}

module.exports = { createRequestBudget, normalizeRequestDuration };
