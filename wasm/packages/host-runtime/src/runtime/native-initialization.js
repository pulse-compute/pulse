'use strict';
// Private once-per-instance lifecycle. A failed/reentrant initializer is terminal.
function createNativeInitializer(initialize) {
  let state = 'uninitialized';
  function run() {
    if (state === 'initialized') return;
    if (state !== 'uninitialized') { state = 'failed'; throw new TypeError('Native initialization is unavailable.'); }
    state = 'initializing';
    try {
      initialize();
      if (state !== 'initializing') throw new TypeError('Native initialization reentered.');
      state = 'initialized';
    } catch (error) { state = 'failed'; throw error; }
  }
  return Object.freeze({ run, assertReady() {
    if (state !== 'initialized') { state = 'failed'; throw new TypeError('Native host calls are forbidden during initialization.'); }
  }, get state() { return state; } });
}
module.exports = { createNativeInitializer };
