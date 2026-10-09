'use strict';
const { GRAPH_DIAGNOSTICS } = require('./schema');
const { fail } = require('./data');
// Structural allowlisting belongs to schema.js. These are cross-field checks.
function checkGraphDiagnostic(value, functionCount = null) {
  if (GRAPH_DIAGNOSTICS[value.code] !== value.reason) fail('REPORT_GRAPH_DIAGNOSTIC');
  if (value.functionIndex !== null && functionCount !== null && value.functionIndex >= functionCount) fail('REPORT_GRAPH_DIAGNOSTIC');
  const indexed = ['function-name', 'duplicate-name', 'direct-target', 'direct-call-shape', 'edge-limit'].includes(value.code);
  if (indexed !== (value.functionIndex !== null)) fail('REPORT_GRAPH_DIAGNOSTIC');
  const budget = value.reason === 'graph-budget-exhausted';
  const mismatch = ['function-index', 'import-count', 'definition-count', 'direct-call-shape', 'direct-call-scope'].includes(value.code);
  if (budget || mismatch) {
    if (value.observed === null || value.expected === null || (budget ? value.observed <= value.expected : value.observed === value.expected)) fail('REPORT_GRAPH_DIAGNOSTIC');
    if (budget && value.expected !== ({ 'text-byte-limit': 32 * 1024 * 1024, 'function-limit': 100000,
      'edge-limit': 100000, 'traversal-work-limit': 1000000 })[value.code]) fail('REPORT_GRAPH_DIAGNOSTIC');
  } else if (value.observed !== null || value.expected !== null) fail('REPORT_GRAPH_DIAGNOSTIC');
}
module.exports = { checkGraphDiagnostic };
