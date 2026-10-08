'use strict';
const { describeDiagnostic, decorateDiagnostic } = require('../diagnostics.js');

function secretTokens(secrets) {
  return [...new Set(Object.values(secrets || {})
    .filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => right.length - left.length);
}

function redactString(value, tokens) {
  let text = String(value);
  for (const token of tokens) text = text.split(token).join('<redacted>');
  return text;
}

function redactValue(value, tokens, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value, tokens);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return '<binary>';
  if (seen.has(value)) return '<circular>';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, tokens, seen));
  const out = {};
  for (const [key, entry] of Object.entries(value)) out[key] = redactValue(entry, tokens, seen);
  return out;
}

function errorSummary(error, secrets) {
  const tokens = secretTokens(secrets);
  const code = error && error.code ? String(error.code) : undefined;
  const descriptor = describeDiagnostic(code);
  const diagnostics = error && Array.isArray(error.diagnostics)
    ? Object.freeze(redactValue(error.diagnostics, tokens).map((entry) => decorateDiagnostic(entry)))
    : undefined;
  return Object.freeze({
    name: error && error.name ? String(error.name) : 'Error',
    code,
    title: descriptor.title,
    summary: descriptor.summary,
    category: descriptor.category,
    message: redactString(error && error.message ? error.message : String(error), tokens),
    remediation: descriptor.remediation,
    stability: descriptor.stability,
    scope: descriptor.scope,
    docs: descriptor.docs,
    detail: error && error.detail ? Object.freeze(redactValue(error.detail, tokens)) : undefined,
    diagnostics,
    execution: error && error.execution ? Object.freeze(redactValue({
      executionId: error.execution.executionId,
      resolutionOrder: error.execution.resolutionOrder,
      continuations: error.execution.continuations
    }, tokens)) : undefined
  });
}

module.exports = { errorSummary, secretTokens, redactValue };
