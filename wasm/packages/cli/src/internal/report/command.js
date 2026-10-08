'use strict';

const path = require('node:path');
const { PulseProjectError } = require('../project-error');
const { describeDiagnostic } = require('../../diagnostics');
const { resolveWorkspace } = require('../../workspace');
const { outputPath, writeHtml } = require('./output');

function diagnostic(code) {
  return new PulseProjectError(code, describeDiagnostic(code).summary);
}
function validateReportRequest(request) {
  if (request.json && request.html || request.outDir !== undefined && !request.html
    || request.artifact !== undefined && (request.directory !== undefined || request.profile !== undefined)) {
    throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', 'Report requires one format; --out requires --html; --artifact excludes directory and --profile.');
  }
}
function planReport(request, { cwd }) {
  validateReportRequest(request);
  const artifact = request.artifact === undefined ? undefined : path.resolve(cwd, request.artifact);
  const workspace = artifact ? undefined : resolveWorkspace({ cwd, directory: request.directory });
  if (!artifact && !workspace) throw diagnostic('PULSE_CONFIG_NOT_FOUND');
  const root = artifact ? path.dirname(artifact) : workspace.root;
  return Object.freeze({ ok: true, command: 'report', mode: artifact ? 'artifact' : 'retained-project',
    root, ...(artifact ? { artifact } : { directory: workspace.root, profile: request.profile ?? null, profileSelection: 'on-collection' }),
    format: request.html ? 'html' : request.json ? 'json' : 'terminal',
    ...(request.html ? { output: outputPath(root, request.outDir), renderer: 'pulse.report-viewer.v1' } : {}),
    collectOnExecution: true, backgroundWork: false, build: false, executeProjectCode: false });
}
function publicReportError(error) {
  if (error instanceof PulseProjectError) return error;
  // Preserve catalogued selection diagnostics without exposing config/source values.
  if (typeof error?.code === 'string' && error.code.startsWith('PULSE_') && describeDiagnostic(error.code).scope === 'public') return diagnostic(error.code);
  const code = error?.code;
  if (['REPORT_STALE_INPUTS', 'REPORT_CONCURRENT_CHANGE', 'REPORT_IDENTITY'].includes(code)) return diagnostic('PULSE_REPORT_STALE');
  if (['ENOENT', 'REPORT_MISSING_ARTIFACT', 'REPORT_MISSING_COMPLETION', 'REPORT_MISSING_SIDECAR', 'REPORT_INCOMPLETE_BUILD', 'REPORT_INPUT_UNBOUND'].includes(code)) return diagnostic('PULSE_REPORT_EVIDENCE_MISSING');
  if (['REPORT_VERSION', 'REPORT_INPUT_VERSION', 'REPORT_UNSUPPORTED_TARGET'].includes(code)) return diagnostic('PULSE_REPORT_INCOMPATIBLE');
  return diagnostic('PULSE_REPORT_INPUT_INVALID');
}
function executeReport(plan, request, options = {}) {
  try {
    const retained = require('./retained');
    const collected = plan.artifact ? retained.collectArtifactReport(plan.artifact)
      : retained.collectProjectReport({ cwd: plan.root, profile: request.profile, env: options.environment });
    if (request.html) {
      const render = options.reportRenderer || require('./viewer').renderReport;
      const snapshot = collected.currentSnapshotMatched ? 'current' : collected.kind === 'historical-capsule' ? 'historical' : 'artifact';
      if (plan.output === plan.artifact) throw diagnostic('PULSE_REPORT_OUTPUT_UNSAFE');
      return Object.freeze({ file: writeHtml(plan.root, plan.output, render(collected.capsule, { snapshot }), { recordOutput: true, inputFiles: collected.inputFiles }) });
    }
    return collected;
  } catch (error) { throw publicReportError(error); }
}
// Escape all terminal controls, bidi controls and markup; only presentation is
// bounded. JSON emits the complete authoritative capsule unchanged.
function terminalText(value, maximum = 100) {
  const text = String(value).replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f<>]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  return text.length > maximum ? text.slice(0, maximum) + '…' : text;
}
function terminalOverview(collected) {
  const c = collected.capsule, artifact = c.artifacts.find(row => row.id === c.context.primaryArtifactId);
  const mappings = c.measurements.filter(row => row.artifactId === artifact.id && row.metric === 'handler-body');
  const available = mappings.filter(row => row.fact.state === 'available').length;
  const exact = mappings.filter(row => row.fact.state === 'available' && row.fact.coverage === 'exact').length;
  const gaps = Object.values(c.coverage).filter(row => row.status !== 'complete' && row.status !== 'not-applicable').length;
  const handlers = new Set(c.entries.map(row => row.handlerId).filter(Boolean)).size;
  const count = (name, value = c[name].length) => {
    const status = c.coverage[name].status;
    if (status === 'not-applicable') return 'n/a';
    if (status === 'unavailable' && value === 0) return 'unavailable';
    return status === 'complete' ? String(value) : `${value} recorded (${status})`;
  };
  return [
    `Pulse Report: ${terminalText(c.application.name)}`,
    `  profile: ${terminalText(c.context.profile)} | host: ${terminalText(c.context.host)} | target: native`,
    `  evidence: sha256:${c.evidenceHash.value}`,
    `  snapshot: ${collected.kind === 'historical-capsule' ? 'historical replay; current project not checked' : collected.currentSnapshotMatched ? 'current inputs matched' : 'completed artifact verified; current project not checked'}`,
    `  revision: ${terminalText(c.provenance.revision ?? 'unknown')} | dirty: ${c.provenance.dirty === null ? 'unknown' : c.provenance.dirty ? 'yes' : 'no'}`,
    `  routes: ${count('routes')} | handlers: ${count('entries', handlers)} | schemas: ${count('schemas')} | bindings: ${count('bindings')} | resources: ${count('resources')}`,
    `  primary Wasm: ${artifact.bytes} bytes (${artifact.stage}); ${c.artifacts.length} artifact(s)`,
    `  handler mapping: ${available}/${mappings.length} available (${exact} exact); shared bodies are nonadditive`,
    `  observations: ${c.observations.length} | inventory coverage gaps: ${gaps} | missing optional sidecars: ${collected.missingOptionalSidecars.length}`,
    '  Build-review artifact; review contents before sharing publicly.'
  ].join('\n') + '\n';
}
module.exports = { validateReportRequest, planReport, executeReport, publicReportError, terminalText, terminalOverview };
