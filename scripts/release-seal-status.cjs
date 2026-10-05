'use strict';

const fs = require('node:fs');
const path = require('node:path');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function createSealStatus({ resultsRoot, initial, report = true, heartbeatMs = 10000, output = text => process.stdout.write(text) }) {
  const started = Date.now();
  const prefix = new Date(started).toISOString().replace(/[:.]/g, '-');
  const parent = path.join(resultsRoot, 'seal-runs');
  if (report) fs.mkdirSync(parent, { recursive: true });
  const directory = report ? fs.mkdtempSync(path.join(parent, `${prefix}-`)) : null;
  const latest = path.join(resultsRoot, 'release-seal.json');
  const state = { ...initial, runId: directory ? path.basename(directory) : `${prefix}-${process.pid}`,
    runDirectory: directory, status: 'running', startedAt: new Date(started).toISOString(),
    completedAt: null, currentStep: null, steps: [] };
  let terminal = false;
  const persist = (updates = {}, first = false) => {
    Object.assign(state, updates, { updatedAt: new Date().toISOString(), durationMs: Date.now() - started });
    if (report) {
      atomicJson(path.join(directory, 'report.json'), state);
      // An older run finishing must not replace a newer run's current status.
      let owner;
      try { owner = JSON.parse(fs.readFileSync(latest, 'utf8')).runId; } catch (_) { /* first run */ }
      if (first || owner === state.runId) atomicJson(latest, state);
    }
    return { ...state };
  };
  persist({}, true);
  const heartbeat = setInterval(() => {
    persist();
    output(`[pulse:release] Running ${state.currentStep || 'preflight'}; elapsed ${Math.floor(state.durationMs / 1000)}s; run ${state.runId}\n`);
  }, heartbeatMs);
  heartbeat.unref();
  return {
    directory, persist,
    finish(updates) {
      clearInterval(heartbeat);
      terminal = true;
      return persist({ ...updates, currentStep: null, completedAt: new Date().toISOString() });
    },
    close() {
      clearInterval(heartbeat);
      if (!terminal) {
        terminal = true;
        persist({ status: 'interrupted', currentStep: null, completedAt: new Date().toISOString() });
      }
    }
  };
}

module.exports = { createSealStatus };
