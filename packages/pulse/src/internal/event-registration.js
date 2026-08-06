'use strict';

const EVENT_REGISTRATION_VERSION = 'pulse.event-registration.v1';
const EVENT_DECLARATION_VERSION = 'pulse.event-declaration.v1';
const EVENT_TYPE_MAX_BYTES = 128;
const EVENT_SCHEMA_ID_MAX_BYTES = 256;
const SCHEMA_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;
const EVENT_REGISTRATION_READER_SYMBOL_KEY = 'pulse.runtime.event-registration-reader.v1';
const EVENT_REGISTRATION_READER = Symbol.for(EVENT_REGISTRATION_READER_SYMBOL_KEY);

const EVENT_REGISTRATION_DIAGNOSTIC_CODES = Object.freeze({
  TYPE_INVALID: 'PULSEWASM_EVENTS_TYPE_INVALID',
  SCHEMA_ID_INVALID: 'PULSEWASM_EVENTS_SCHEMA_ID_INVALID',
  DECLARATION_INVALID: 'PULSEWASM_EVENTS_DECLARATION_INVALID',
  HANDLER_INVALID: 'PULSEWASM_EVENTS_HANDLER_INVALID',
  TYPE_DUPLICATE: 'PULSEWASM_EVENTS_TYPE_DUPLICATE'
});

function registrationError(code, message, detail = {}) {
  const error = new TypeError(message);
  error.name = 'PulseEventRegistrationError';
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function utf8ByteLength(value) {
  const text = String(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const point = text.codePointAt(index);
    if (point <= 0x7f) bytes += 1;
    else if (point <= 0x7ff) bytes += 2;
    else if (point <= 0xffff) bytes += 3;
    else {
      bytes += 4;
      index += 1;
    }
  }
  return bytes;
}

function requireDataDeclaration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Pulse.on declaration must be a plain object containing only schema.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Pulse.on declaration must be a plain object containing only schema.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Pulse.on declaration must not contain symbol keys.');
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'schema') {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Pulse.on declaration must contain exactly one schema data property.', { fields: keys.sort() });
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'schema');
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Pulse.on declaration.schema must be an own data property.');
  }
  return descriptor.value;
}

function normalizeEventType(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.TYPE_INVALID, 'Pulse.on event type must be a non-empty string.', { value });
  }
  const bytes = utf8ByteLength(value);
  if (bytes > EVENT_TYPE_MAX_BYTES) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.TYPE_INVALID, 'Pulse.on event type exceeds its UTF-8 byte limit.', { bytes, maxBytes: EVENT_TYPE_MAX_BYTES });
  }
  return value;
}

function normalizeEventDeclaration(value) {
  const schema = requireDataDeclaration(value);
  if (schema !== null && (typeof schema !== 'string' || !SCHEMA_ID_PATTERN.test(schema) || utf8ByteLength(schema) > EVENT_SCHEMA_ID_MAX_BYTES)) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.SCHEMA_ID_INVALID, 'Pulse.on schema must be a bounded dotted schema ID or null.', { schema });
  }
  return Object.freeze({ version: EVENT_DECLARATION_VERSION, schemaId: schema });
}

function normalizeEventRegistration(typeInput, declarationInput, handler) {
  const type = normalizeEventType(typeInput);
  const declaration = normalizeEventDeclaration(declarationInput);
  if (typeof handler !== 'function') {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.HANDLER_INVALID, 'Pulse.on requires an event handler function.');
  }
  return Object.freeze({
    version: EVENT_REGISTRATION_VERSION,
    type,
    declaration,
    handler
  });
}

function createEventRegistrationTable() {
  return { entries: [], types: new Set() };
}

function addEventRegistration(table, type, declaration, handler) {
  const registration = normalizeEventRegistration(type, declaration, handler);
  if (table.types.has(registration.type)) {
    throw registrationError(EVENT_REGISTRATION_DIAGNOSTIC_CODES.TYPE_DUPLICATE, `Pulse event type ${JSON.stringify(registration.type)} is already registered.`, { type: registration.type });
  }
  table.types.add(registration.type);
  table.entries.push(registration);
  return registration;
}

function eventRegistrationEntries(table) {
  return Object.freeze([...table.entries]);
}

function bindEventRegistrationReader(application, table) {
  Object.defineProperty(application, EVENT_REGISTRATION_READER, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: () => eventRegistrationEntries(table)
  });
  return application;
}

module.exports = Object.freeze({
  EVENT_REGISTRATION_VERSION,
  EVENT_DECLARATION_VERSION,
  EVENT_TYPE_MAX_BYTES,
  EVENT_SCHEMA_ID_MAX_BYTES,
  EVENT_REGISTRATION_READER_SYMBOL_KEY,
  EVENT_REGISTRATION_DIAGNOSTIC_CODES,
  normalizeEventType,
  normalizeEventDeclaration,
  normalizeEventRegistration,
  createEventRegistrationTable,
  addEventRegistration,
  eventRegistrationEntries,
  bindEventRegistrationReader
});
