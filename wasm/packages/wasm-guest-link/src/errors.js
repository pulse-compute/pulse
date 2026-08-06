'use strict';

const sensitiveKey = /(?:secret|credential|private|token|raw|buffer|payload|contents?|environment)/i;
const sensitiveEnvironmentName = /(?:secret|token|key|credential|password|passphrase|authorization|cookie)/i;
const pemBlock = /-----BEGIN [^-]*(?:PRIVATE|SECRET|ENCRYPTED)[^-]*-----[\s\S]*?-----END [^-]*-----/gi;
const authorizationValue = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const credentialAssignment = /\b(?:secret|token|password|passphrase|credential|private[_-]?key)\s*[=:]\s*[^\s,;]+/gi;

function sensitiveValues() {
  return Object.entries(process.env)
    .filter(([name, value]) => sensitiveEnvironmentName.test(name) && typeof value === 'string' && value.length >= 4)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

function safeString(value, secrets = sensitiveValues()) {
  let result = String(value)
    .replace(pemBlock, '<redacted-private-material>')
    .replace(authorizationValue, '<redacted-authorization>')
    .replace(credentialAssignment, '<redacted-credential>');
  for (const secret of secrets) result = result.split(secret).join('<redacted-environment-value>');
  return result.slice(0, 2048);
}

function safeDetails(value, depth = 0, secrets = sensitiveValues()) {
  if (depth > 5) return '<omitted>';
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '<redacted-bytes>';
  if (Array.isArray(value)) return Object.freeze(value.slice(0, 32).map((entry) => safeDetails(entry, depth + 1, secrets)));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return safeString(value, secrets);
    return value;
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = sensitiveKey.test(key) ? '<redacted>' : safeDetails(child, depth + 1, secrets);
  }
  return Object.freeze(result);
}

class GuestLinkError extends Error {
  constructor(code, message, details) {
    super(safeString(message));
    this.name = 'GuestLinkError';
    this.code = code;
    if (details !== undefined) {
      const detail = safeDetails(details);
      this.detail = detail;
      Object.defineProperty(this, 'details', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: detail
      });
    }
  }
}

function fail(code, message, details) {
  throw new GuestLinkError(code, message, details);
}

function wrap(error, code, message, details = {}) {
  if (error instanceof GuestLinkError) throw error;
  fail(code, message, {
    ...details,
    cause: error && error.message ? error.message : String(error)
  });
}

module.exports = Object.freeze({
  GuestLinkError,
  fail,
  wrap,
  safeDetails,
  safeString
});
