'use strict';
// Test-owned ASC hooks. No product compiler or dependency files are modified.
const Base = require('../../../packages/build-support/src/native-retention-transform.cjs');
const key = Symbol.for('pulse.o03.compiler-probe');

function snapshot() {
  const usage = process.resourceUsage();
  return { wallMs: performance.now(), userCpuMs: usage.userCPUTime / 1000,
    systemCpuMs: usage.systemCPUTime / 1000, rssBytes: process.memoryUsage.rss(),
    processPeakRssBytes: usage.maxRSS * 1024 };
}

function interval(start, end = snapshot()) {
  return { startWallMs: start.wallMs, endWallMs: end.wallMs,
    wallMs: end.wallMs - start.wallMs, userCpuMs: end.userCpuMs - start.userCpuMs,
    systemCpuMs: end.systemCpuMs - start.systemCpuMs,
    rssBeforeBytes: start.rssBytes, rssAfterBytes: end.rssBytes,
    processPeakBeforeBytes: start.processPeakRssBytes, processPeakAfterBytes: end.processPeakRssBytes,
    // maxRSS is a cumulative high-water mark. A rise localizes a new peak to
    // this interval; otherwise its internal peak is unknown, not zero.
    newlyReachedPeakBytes: end.processPeakRssBytes > start.processPeakRssBytes ? end.processPeakRssBytes : null };
}

function createRecorder() {
  const phases = new Map(), groups = [], windows = [];
  const record = (phase, span) => {
    windows.push({ phase, start: span.startWallMs, end: span.endWallMs });
    const previous = phases.get(phase);
    if (!previous) phases.set(phase, { phase, count: 1, ...span,
      maximumBoundaryRssBytes: Math.max(span.rssBeforeBytes, span.rssAfterBytes) });
    else {
      previous.count++;
      for (const name of ['wallMs', 'userCpuMs', 'systemCpuMs']) previous[name] += span[name];
      previous.rssAfterBytes = span.rssAfterBytes;
      previous.endWallMs = span.endWallMs;
      previous.processPeakAfterBytes = span.processPeakAfterBytes;
      previous.maximumBoundaryRssBytes = Math.max(previous.maximumBoundaryRssBytes, span.rssBeforeBytes, span.rssAfterBytes);
      previous.newlyReachedPeakBytes = Math.max(previous.newlyReachedPeakBytes || 0, span.newlyReachedPeakBytes || 0) || null;
    }
  };
  const measure = (phase, fn) => {
    const start = snapshot();
    try { return fn(); } finally { record(phase, interval(start)); }
  };
  const recorder = { record, measure, groups, phases, windows, selectedNames: null };
  process[key] = recorder;
  return recorder;
}

function instrumentStats(stats, recorder) {
  let last, lastStart, lastEnd;
  stats.begin = snapshot;
  stats.end = start => {
    lastStart = start; lastEnd = snapshot(); last = interval(start, lastEnd);
    return last.wallMs * 1e6;
  };
  for (const property of ['parseTime', 'initializeTime', 'compileTime', 'transformTime', 'validateTime', 'optimizeTime', 'emitTime', 'total']) {
    let value = stats[property];
    Object.defineProperty(stats, property, { enumerable: true, configurable: true,
      get: () => value, set: next => {
        value = next;
        if (last) recorder.record(property === 'total' ? 'asc-total' : 'asc-' + property.replace('Time', ''), last);
        if (property === 'emitTime') recorder.lastEmitEnd = lastEnd;
        if (property === 'optimizeTime' && recorder.firstPostStart)
          recorder.record('binaryen-default-optimization', interval(lastStart, recorder.firstPostStart));
      } });
  }
  return stats;
}

module.exports = class CompilerPhaseProbe extends Base {
  afterParse(parser) {
    const r = process[key];
    r.measure('retention-name-selection', () => super.afterParse(parser));
    r.selectedNames = this.retainedNames.length;
  }
  afterCompile(module) {
    const r = process[key], original = module.runPasses;
    let retention = true;
    module.runPasses = (...args) => {
      const phase = retention ? 'retention-no-inline-passes' : 'binaryen-post-passes';
      const start = snapshot();
      if (!retention && !r.firstPostStart) r.firstPostStart = start;
      try { return original.apply(module, args); }
      finally {
        const span = interval(start);
        r.record(phase, span);
        r.groups.push({ phase, passes: args[0],
          ...(retention ? { pattern: this.binaryen.getPassArgument('no-inline') } : {}), ...span });
      }
    };
    try { r.measure('retention-total', () => super.afterCompile(module)); }
    finally { retention = false; }
    // Keep the wrapper until asc finishes its post-optimization --runPasses.
  }
};
Object.assign(module.exports, { snapshot, interval, createRecorder, instrumentStats });
