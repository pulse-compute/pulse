'use strict';

const { fastlyJavascriptProviderError, isPulseRuntimeError } = require('./errors.js');

const FASTLY_JAVASCRIPT_GRIP_BROADCAST_VERSION = 'pulse.fastly-javascript-grip-broadcast.v1';
const DEFAULT_MAX_REQUEST_BYTES = 65536;
const DEFAULT_MAX_RESPONSE_BYTES = 65536;

function positiveSafeInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`Pulse Fastly JavaScript GRIP ${field} must be a positive safe integer.`);
  }
  return number;
}

function normalizeEndpoint(input) {
  let endpoint;
  try { endpoint = new URL(String(input || '')); }
  catch (error) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_ENDPOINT_INVALID',
      'Fastly JavaScript GRIP publish endpoint must be an absolute HTTP or HTTPS URL.',
      { operation: 'broadcast', configuration: 'bindings.grip.publishEndpoint' },
      error
    );
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_ENDPOINT_INVALID',
      'Fastly JavaScript GRIP publish endpoint must use HTTP or HTTPS.',
      { operation: 'broadcast', protocol: endpoint.protocol }
    );
  }
  return endpoint;
}

function normalizeAuthentication(input) {
  if (input === undefined) return undefined;
  const scheme = input && String(input.scheme || 'bearer').toLowerCase();
  const secretRef = input && typeof input.secretRef === 'string' ? input.secretRef.trim() : '';
  if (scheme !== 'bearer') {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_AUTH_SCHEME_UNSUPPORTED',
      'Fastly JavaScript GRIP supports bearer authentication only.',
      { operation: 'broadcast', scheme }
    );
  }
  if (!secretRef) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_SECRET_REFERENCE_REQUIRED',
      'Fastly JavaScript GRIP bearer authentication requires a secret reference.',
      { operation: 'broadcast', configuration: 'bindings.grip.authentication.secretRef' }
    );
  }
  return Object.freeze({ scheme, secretRef });
}

function requestBody(payload) {
  const channel = payload && typeof payload.channel === 'string' ? payload.channel.trim() : '';
  if (!channel || /[,\r\n]/.test(channel)) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_CHANNEL_INVALID',
      'GRIP broadcast channel must be non-empty and contain no commas or line breaks.',
      { operation: 'broadcast' }
    );
  }
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === undefined) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_MESSAGE_INVALID',
      'GRIP broadcast requires a JSON-compatible data value.',
      { operation: 'broadcast' }
    );
  }
  try {
    const body = JSON.stringify({
      channel,
      data: payload.data,
      ...(payload.event === undefined ? {} : { event: String(payload.event) }),
      ...(payload.id === undefined ? {} : { id: String(payload.id) })
    });
    if (typeof body !== 'string') throw new TypeError('not serializable');
    return body;
  } catch (error) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_MESSAGE_INVALID',
      'GRIP broadcast message must be JSON-compatible.',
      { operation: 'broadcast' },
      error
    );
  }
}

async function readBoundedResponseText(response, maxBytes) {
  const length = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_RESPONSE_TOO_LARGE',
      'GRIP broadcast provider response exceeded the configured byte limit.',
      { operation: 'broadcast', maxResponseBytes: maxBytes }
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        try { await reader.cancel(); } catch (_) { /* Best-effort host stream cleanup. */ }
        throw fastlyJavascriptProviderError(
          'PULSE_GRIP_BROADCAST_RESPONSE_TOO_LARGE',
          'GRIP broadcast provider response exceeded the configured byte limit.',
          { operation: 'broadcast', maxResponseBytes: maxBytes }
        );
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function normalizeAck(status, text) {
  if (!text.trim()) return Object.freeze({ accepted: true, status });
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_RESPONSE_INVALID',
      'GRIP broadcast provider returned an invalid acknowledgement.',
      { operation: 'broadcast', status },
      error
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_RESPONSE_INVALID',
      'GRIP broadcast provider acknowledgement must be an object.',
      { operation: 'broadcast', status }
    );
  }
  return Object.freeze({
    accepted: parsed.accepted !== false,
    status,
    ...(parsed.messageId === undefined ? {} : { messageId: String(parsed.messageId) })
  });
}

function createFastlyJavascriptGripBroadcast(options = {}) {
  const grip = options.grip && typeof options.grip === 'object' ? options.grip : {};
  const endpoint = normalizeEndpoint(grip.publishEndpoint || grip.publishUrl);
  const authentication = normalizeAuthentication(grip.authentication);
  const bindings = options.bindings && typeof options.bindings === 'object' ? options.bindings : {};
  const backends = bindings.backends && typeof bindings.backends === 'object' ? bindings.backends : {};
  const backend = typeof grip.publishBackend === 'string' && grip.publishBackend.trim()
    ? grip.publishBackend.trim()
    : (typeof backends[endpoint.origin] === 'string' ? backends[endpoint.origin].trim() : '');
  if (!backend && bindings.dynamicBackends !== true) {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_BACKEND_REQUIRED',
      'Fastly JavaScript GRIP requires a named publish backend unless dynamic backends are enabled.',
      { operation: 'broadcast', origin: endpoint.origin, configuration: 'bindings.grip.publishBackend' }
    );
  }
  if (typeof options.fetchImplementation !== 'function') {
    throw fastlyJavascriptProviderError(
      'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
      'Fastly JavaScript GRIP requires the provider fetch implementation.',
      { operation: 'broadcast' }
    );
  }
  const maxRequestBytes = positiveSafeInteger(grip.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes');
  const maxResponseBytes = positiveSafeInteger(grip.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 'maxResponseBytes');

  return async function fastlyJavascriptGripBroadcast(payload, execution = {}) {
    const body = requestBody(payload);
    if (new TextEncoder().encode(body).byteLength > maxRequestBytes) {
      throw fastlyJavascriptProviderError(
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
      const secret = typeof options.secretLookup === 'function'
        ? await options.secretLookup(authentication.secretRef)
        : undefined;
      if (typeof secret !== 'string' || secret.length === 0) {
        throw fastlyJavascriptProviderError(
          'PULSE_GRIP_BROADCAST_SECRET_REQUIRED',
          'GRIP broadcast authentication secret is unavailable.',
          { operation: 'broadcast', secretRef: authentication.secretRef }
        );
      }
      if (typeof execution.registerRedactionValue === 'function') execution.registerRedactionValue(secret);
      headers.set('authorization', `Bearer ${secret}`);
    }

    let response;
    let text;
    try {
      response = await options.fetchImplementation(endpoint.href, {
        method: 'POST',
        headers,
        body,
        signal: execution.signal,
        redirect: 'error',
        ...(backend ? { backend } : {})
      });
      if (!(response instanceof Response)) {
        throw fastlyJavascriptProviderError(
          'PULSE_GRIP_BROADCAST_RESPONSE_INVALID',
          'GRIP broadcast provider must return a Web Response.',
          { operation: 'broadcast' }
        );
      }
      text = await readBoundedResponseText(response, maxResponseBytes);
    } catch (error) {
      if (isPulseRuntimeError(error)) throw error;
      if (execution.signal && execution.signal.aborted) {
        throw fastlyJavascriptProviderError(
          'PULSE_GRIP_BROADCAST_ABORTED',
          'GRIP broadcast was cancelled with its owning request.',
          { operation: 'broadcast' }
        );
      }
      throw fastlyJavascriptProviderError(
        'PULSE_GRIP_BROADCAST_NETWORK',
        'GRIP broadcast provider request failed.',
        { operation: 'broadcast' },
        error
      );
    }
    if (response.status < 200 || response.status > 299) {
      throw fastlyJavascriptProviderError(
        'PULSE_GRIP_BROADCAST_REJECTED',
        'GRIP broadcast provider rejected the publication.',
        { operation: 'broadcast', status: response.status }
      );
    }
    return normalizeAck(response.status, text);
  };
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_GRIP_BROADCAST_VERSION,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  createFastlyJavascriptGripBroadcast
});
