'use strict';

const { PulseNodeJavascriptPackageEffectError } = require('./package-effects.js');

const NODE_JAVASCRIPT_GRIP_BROADCAST_VERSION = 'pulse.node-javascript-grip-broadcast.v1';
const DEFAULT_MAX_REQUEST_BYTES = 65536;
const DEFAULT_MAX_RESPONSE_BYTES = 65536;

function fail(code, message, detail = {}) {
  throw new PulseNodeJavascriptPackageEffectError(code, message, detail);
}

function positiveSafeInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`Pulse Node JavaScript GRIP ${field} must be a positive safe integer.`);
  }
  return number;
}

function normalizeEndpoint(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    fail(
      'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
      'GRIP broadcast requires an explicitly configured provider publish endpoint.',
      { operation: 'broadcast', configuration: 'grip.publishEndpoint' }
    );
  }
  let endpoint;
  try {
    endpoint = new URL(input);
  } catch {
    fail(
      'PULSE_GRIP_BROADCAST_ENDPOINT_INVALID',
      'GRIP broadcast publishEndpoint must be an absolute HTTP or HTTPS URL.',
      { operation: 'broadcast', configuration: 'grip.publishEndpoint' }
    );
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    fail(
      'PULSE_GRIP_BROADCAST_ENDPOINT_INVALID',
      'GRIP broadcast publishEndpoint must use HTTP or HTTPS.',
      { operation: 'broadcast', configuration: 'grip.publishEndpoint', protocol: endpoint.protocol }
    );
  }
  return endpoint.href;
}

function normalizeAuthentication(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Pulse Node JavaScript GRIP authentication must be an object.');
  }
  const scheme = input.scheme === undefined ? 'bearer' : String(input.scheme).toLowerCase();
  if (scheme !== 'bearer') {
    fail(
      'PULSE_GRIP_BROADCAST_AUTH_SCHEME_UNSUPPORTED',
      'GRIP broadcast currently supports only bearer authentication.',
      { operation: 'broadcast', scheme }
    );
  }
  const secretRef = typeof input.secretRef === 'string' ? input.secretRef.trim() : '';
  if (!secretRef) {
    fail(
      'PULSE_GRIP_BROADCAST_SECRET_REFERENCE_REQUIRED',
      'GRIP bearer authentication requires a named secret reference.',
      { operation: 'broadcast', configuration: 'grip.authentication.secretRef' }
    );
  }
  return Object.freeze({ scheme, secretRef });
}

function requestBody(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('PULSE_GRIP_BROADCAST_MESSAGE_INVALID', 'GRIP broadcast requires a structured message.', { operation: 'broadcast' });
  }
  const channel = typeof payload.channel === 'string' ? payload.channel.trim() : '';
  if (!channel || /[,\r\n]/.test(channel)) {
    fail(
      'PULSE_GRIP_BROADCAST_CHANNEL_INVALID',
      'GRIP broadcast channel must be a non-empty string without commas or line breaks.',
      { operation: 'broadcast' }
    );
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === undefined) {
    fail('PULSE_GRIP_BROADCAST_MESSAGE_INVALID', 'GRIP broadcast requires a JSON-compatible data value.', { operation: 'broadcast' });
  }
  try {
    const body = JSON.stringify({
      channel,
      data: payload.data,
      ...(payload.event === undefined ? {} : { event: String(payload.event) }),
      ...(payload.id === undefined ? {} : { id: String(payload.id) })
    });
    if (typeof body !== 'string') throw new TypeError('not JSON serializable');
    return body;
  } catch {
    fail('PULSE_GRIP_BROADCAST_MESSAGE_INVALID', 'GRIP broadcast message must be JSON-compatible.', { operation: 'broadcast' });
  }
}

async function readBoundedResponseText(response, maxBytes) {
  const contentLength = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    fail(
      'PULSE_GRIP_BROADCAST_RESPONSE_TOO_LARGE',
      'GRIP broadcast provider response exceeded the configured byte limit.',
      { operation: 'broadcast', maxResponseBytes: maxBytes }
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        fail(
          'PULSE_GRIP_BROADCAST_RESPONSE_TOO_LARGE',
          'GRIP broadcast provider response exceeded the configured byte limit.',
          { operation: 'broadcast', maxResponseBytes: maxBytes }
        );
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function normalizeAck(status, text) {
  if (!text.trim()) return Object.freeze({ accepted: true, status });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(
      'PULSE_GRIP_BROADCAST_RESPONSE_INVALID',
      'GRIP broadcast provider returned an invalid acknowledgement.',
      { operation: 'broadcast', status }
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(
      'PULSE_GRIP_BROADCAST_RESPONSE_INVALID',
      'GRIP broadcast provider acknowledgement must be an object.',
      { operation: 'broadcast', status }
    );
  }
  const messageId = parsed.messageId === undefined ? undefined : String(parsed.messageId);
  return Object.freeze({
    accepted: parsed.accepted !== false,
    status,
    ...(messageId === undefined ? {} : { messageId })
  });
}

function createNodeJavascriptGripBroadcast(options = {}) {
  const endpoint = normalizeEndpoint(options.publishEndpoint);
  const authentication = normalizeAuthentication(options.authentication);
  const maxRequestBytes = positiveSafeInteger(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes');
  const maxResponseBytes = positiveSafeInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 'maxResponseBytes');
  const fetchImplementation = options.fetchImplementation;
  const secretLookup = options.secretLookup;
  if (typeof fetchImplementation !== 'function') {
    fail(
      'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
      'GRIP broadcast requires an explicitly supplied provider fetch implementation.',
      { operation: 'broadcast', configuration: 'fetchImplementation' }
    );
  }

  return async function nodeJavascriptGripBroadcast(payload, execution = {}) {
    const body = requestBody(payload);
    const requestBytes = new TextEncoder().encode(body).byteLength;
    if (requestBytes > maxRequestBytes) {
      fail(
        'PULSE_GRIP_BROADCAST_REQUEST_TOO_LARGE',
        'GRIP broadcast request exceeded the configured byte limit.',
        { operation: 'broadcast', maxRequestBytes }
      );
    }
    const headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/json; charset=utf-8'
    });
    if (authentication) {
      const secret = typeof secretLookup === 'function' ? await secretLookup(authentication.secretRef) : undefined;
      if (typeof secret !== 'string' || secret.length === 0) {
        fail(
          'PULSE_GRIP_BROADCAST_SECRET_REQUIRED',
          'GRIP broadcast authentication secret is unavailable.',
          { operation: 'broadcast', secretRef: authentication.secretRef }
        );
      }
      headers.set('authorization', `Bearer ${secret}`);
    }

    let response;
    let text;
    try {
      response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: execution.signal,
        redirect: 'error'
      });
      if (!(response instanceof Response)) {
        fail('PULSE_GRIP_BROADCAST_RESPONSE_INVALID', 'GRIP broadcast provider must return a Web Response.', { operation: 'broadcast' });
      }
      text = await readBoundedResponseText(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof PulseNodeJavascriptPackageEffectError) throw error;
      if (execution.signal && execution.signal.aborted) {
        fail('PULSE_GRIP_BROADCAST_ABORTED', 'GRIP broadcast was cancelled with its owning request.', { operation: 'broadcast' });
      }
      fail('PULSE_GRIP_BROADCAST_NETWORK', 'GRIP broadcast provider request failed.', { operation: 'broadcast' });
    }
    if (response.status < 200 || response.status > 299) {
      fail(
        'PULSE_GRIP_BROADCAST_REJECTED',
        'GRIP broadcast provider rejected the publication.',
        { operation: 'broadcast', status: response.status }
      );
    }
    return normalizeAck(response.status, text);
  };
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_GRIP_BROADCAST_VERSION,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  createNodeJavascriptGripBroadcast
});
