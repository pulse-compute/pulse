'use strict';

const LOGGING_CONTRACT_VERSION = 'pulse.logging.v1';
const DEFAULT_REPORTING_LEVEL = 'info';
const REPORTING_LEVEL_NAMES = Object.freeze(['off', 'error', 'warn', 'info', 'debug']);
const REPORTING_LEVELS = Object.freeze(Object.fromEntries(
  REPORTING_LEVEL_NAMES.map((name, level) => [name, level])
));
const LOG_METHOD_LEVELS = Object.freeze({
  error: REPORTING_LEVELS.error,
  warn: REPORTING_LEVELS.warn,
  info: REPORTING_LEVELS.info,
  debug: REPORTING_LEVELS.debug
});
const PULSE_LOG_ABI = Object.freeze({
  version: 'pulse.log-abi.v1',
  operation: 'pulse_log',
  signature: 'pulse_log(level:i32,message_ptr:i32,message_len:i32)->void',
  parameters: Object.freeze([
    Object.freeze({ name: 'level', type: 'i32' }),
    Object.freeze({ name: 'message_ptr', type: 'i32' }),
    Object.freeze({ name: 'message_len', type: 'i32' })
  ]),
  result: 'void',
  synchronous: true,
  effect: false,
  continuation: false,
  suspension: false,
  providerAdapterOwned: true
});

function normalizeReportingLevel(value = DEFAULT_REPORTING_LEVEL, field = 'reporting') {
  const normalized = String(value).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(REPORTING_LEVELS, normalized)) {
    const error = new TypeError(`${field} must be one of ${REPORTING_LEVEL_NAMES.join(', ')}.`);
    error.code = 'PULSE_REPORTING_LEVEL_UNSUPPORTED';
    error.details = Object.freeze({ field, value, allowed: REPORTING_LEVEL_NAMES });
    throw error;
  }
  return normalized;
}

function reportingLevelNumber(value = DEFAULT_REPORTING_LEVEL, field = 'reporting') {
  return REPORTING_LEVELS[normalizeReportingLevel(value, field)];
}

function resolveReportingLevel(profileReporting, pulseReporting = DEFAULT_REPORTING_LEVEL) {
  return normalizeReportingLevel(
    profileReporting === undefined || profileReporting === null
      ? pulseReporting
      : profileReporting,
    'reporting'
  );
}

function reportingDescriptor(value = DEFAULT_REPORTING_LEVEL) {
  const name = normalizeReportingLevel(value);
  return Object.freeze({
    version: LOGGING_CONTRACT_VERSION,
    name,
    level: REPORTING_LEVELS[name],
    default: name === DEFAULT_REPORTING_LEVEL,
    abi: PULSE_LOG_ABI
  });
}

function logStatementEnabled(statementLevel, reportingLevel) {
  const statement = typeof statementLevel === 'number'
    ? statementLevel
    : LOG_METHOD_LEVELS[String(statementLevel)];
  const reporting = typeof reportingLevel === 'number'
    ? reportingLevel
    : reportingLevelNumber(reportingLevel);
  return Number.isInteger(statement) && statement >= REPORTING_LEVELS.error && statement <= reporting;
}

module.exports = Object.freeze({
  LOGGING_CONTRACT_VERSION,
  DEFAULT_REPORTING_LEVEL,
  REPORTING_LEVEL_NAMES,
  REPORTING_LEVELS,
  LOG_METHOD_LEVELS,
  PULSE_LOG_ABI,
  normalizeReportingLevel,
  reportingLevelNumber,
  resolveReportingLevel,
  reportingDescriptor,
  logStatementEnabled
});
