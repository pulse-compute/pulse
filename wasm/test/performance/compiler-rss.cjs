'use strict';
// Preloaded only in the real ASC child. No sampled /proc approximation or
// cumulative parent-process high-water mark is substituted for compiler RSS.
// ASC re-execs itself for source maps; append each PID so its small launcher
// cannot overwrite the actual compiler observation when it exits last.
process.once('exit', () => {
  let peakBytes = null;
  try { const value = process.resourceUsage().maxRSS * 1024; if (value > 0) peakBytes = value; } catch (_) { /* unavailable on this host */ }
  require('node:fs').appendFileSync(process.env.PS08_COMPILER_RSS_FILE,
    JSON.stringify({ pid: process.pid, peakBytes }) + '\n');
});
