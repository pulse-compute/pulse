'use strict';

const path = require('node:path');
const { PulseProjectError } = require('../project-error');
const { readFile } = require('./files');
const { parseCapsule } = require('./capsule');
const { compareCapsules } = require('./comparison');
const { outputPath, writeHtml } = require('./output');
const { publicReportError } = require('./command');

function validateCompareRequest(request) {
  if (request.json && request.html || request.outDir !== undefined && !request.html) {
    throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', 'Compare requires one format; --out requires --html.');
  }
  if (request.help) return;
  for (const key of ['before', 'after']) {
    if (request[key] === undefined) throw new PulseProjectError('PULSE_ARGUMENT_MISSING', 'Compare requires before and after Report capsule paths.');
    if (typeof request[key] !== 'string' || !request[key] || request[key].includes('\0')) {
      throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', 'Compare input paths must be nonempty strings without NUL characters.');
    }
  }
}

function planCompare(request, { cwd }) {
  validateCompareRequest(request);
  const root = path.resolve(cwd), before = path.resolve(root, request.before), after = path.resolve(root, request.after);
  const output = request.html ? outputPath(root, request.outDir ?? '.pulse/reports/pulse-comparison.html') : undefined;
  if (output === before || output === after) throw new PulseProjectError('PULSE_REPORT_OUTPUT_UNSAFE', 'Comparison output cannot overwrite either input capsule.');
  return Object.freeze({ ok: true, command: 'compare', mode: 'saved-capsules', root, before, after,
    format: request.html ? 'html' : 'json', ...(output ? { output, renderer: 'pulse.report-comparison-viewer.v1' } : {}),
    backgroundWork: false, build: false, executeProjectCode: false, collectOnExecution: true });
}

function executeCompare(plan, request) {
  try {
    const read = file => parseCapsule(readFile(path.dirname(file), path.basename(file)).bytes);
    const comparison = compareCapsules(read(plan.before), read(plan.after));
    if (!request.html) return comparison;
    const html = require('./comparison-viewer').renderComparison(comparison);
    return Object.freeze({ file: writeHtml(plan.root, plan.output, html, {
      recordOutput: true,
      inputFiles: [plan.before, plan.after].map(file => path.relative(plan.root, file).split(path.sep).join('/'))
    }) });
  } catch (error) { throw publicReportError(error); }
}

module.exports = { validateCompareRequest, planCompare, executeCompare };
