'use strict';

const path = require('node:path');

const PACKAGE_VERSION = 'pulsewasm-route-extractor@1.0.0-beta.4';
const DIAGNOSTICS_VERSION = 'pulsewasm.diagnostics.v1';

function stableFileName(fileName, cwd) {
  if (!fileName) return fileName;
  if (fileName.startsWith('<') && fileName.endsWith('>')) return fileName;
  const root = cwd || process.cwd();
  const rel = path.relative(root, fileName);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : fileName;
}

function normalizeArtifact(value, cwd) {
  if (Array.isArray(value)) return value.map((item) => normalizeArtifact(item, cwd));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'file' || key === 'source') && typeof child === 'string') {
      out[key] = stableFileName(child, cwd);
    } else {
      out[key] = normalizeArtifact(child, cwd);
    }
  }
  return out;
}

class ExtractionError extends Error {
  constructor(diagnostics, options = {}) {
    const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
    const normalized = normalizeDiagnostics(list);
    super(formatDiagnostics(normalized));
    this.name = 'ExtractionError';
    this.diagnostics = normalized;
    this.status = options.status || 'error';
    this.passes = options.passes || [];
    this.summary = options.summary;
    this.source = options.source;
  }
}

function sourceLoc(sourceFile, node) {
  const start = typeof node.getStart === 'function' ? node.getStart(sourceFile) : node.pos ?? 0;
  const end = node.end ?? start;
  const startLC = sourceFile.getLineAndCharacterOfPosition(start);
  const endLC = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    file: sourceFile.fileName,
    start: { line: startLC.line + 1, column: startLC.character + 1, offset: start },
    end: { line: endLC.line + 1, column: endLC.character + 1, offset: end }
  };
}

function diagnostic(sourceFile, node, code, message, hint, options = {}) {
  return normalizeDiagnostic({
    code,
    message,
    hint,
    severity: options.severity || 'error',
    pass: options.pass || options.phase,
    phase: options.phase,
    loc: node ? sourceLoc(sourceFile, node) : { file: sourceFile.fileName }
  });
}

function normalizeDiagnostic(diag, index) {
  const loc = diag.loc || { file: '<unknown>' };
  const out = {
    code: diag.code || 'PULSEWASM_DIAGNOSTIC',
    severity: diag.severity || 'error',
    message: diag.message || '',
    loc
  };
  const pass = diag.pass || diag.phase;
  if (pass) out.pass = pass;
  if (diag.hint) out.hint = diag.hint;
  if (diag.details !== undefined) out.details = diag.details;
  if (typeof index === 'number') out.index = index;
  return out;
}

function normalizeDiagnostics(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : diagnostics ? [diagnostics] : [];
  return list.map((diag, index) => normalizeDiagnostic(diag, index));
}

function countDiagnostics(diagnostics) {
  const counts = { total: diagnostics.length, error: 0, warning: 0, info: 0 };
  for (const diag of diagnostics) {
    const severity = diag.severity || 'error';
    if (counts[severity] === undefined) counts[severity] = 0;
    counts[severity] += 1;
  }
  return counts;
}

function createDiagnosticsEnvelope(options = {}) {
  const diagnostics = normalizeDiagnostics(options.diagnostics || []);
  return normalizeArtifact({
    version: DIAGNOSTICS_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: options.status || (diagnostics.some((diag) => diag.severity === 'error') ? 'error' : 'ok'),
    source: options.source,
    entryRouter: options.entryRouter,
    passes: options.passes || [],
    summary: options.summary,
    counts: countDiagnostics(diagnostics),
    diagnostics
  }, options.cwd || process.cwd());
}

function formatDiagnostics(diagnostics) {
  return normalizeDiagnostics(diagnostics)
    .map((diag) => {
      const loc = diag.loc || {};
      const start = loc.start ? `${loc.file}:${loc.start.line}:${loc.start.column}` : loc.file || '<unknown>';
      const pass = diag.pass ? ` [${diag.pass}]` : '';
      const hint = diag.hint ? `\n  hint: ${diag.hint}` : '';
      return `${start}${pass} ${diag.code}: ${diag.message}${hint}`;
    })
    .join('\n');
}

module.exports = {
  PACKAGE_VERSION,
  DIAGNOSTICS_VERSION,
  ExtractionError,
  countDiagnostics,
  createDiagnosticsEnvelope,
  diagnostic,
  formatDiagnostics,
  normalizeArtifact,
  normalizeDiagnostic,
  normalizeDiagnostics,
  sourceLoc,
  stableFileName
};
