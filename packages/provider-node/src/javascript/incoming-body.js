'use strict';

const host = require('@pulse-compute/runtime/host');
const CHUNK_BYTES = 16 * 1024;
const QUEUE_BYTES = 64 * 1024;
const error = (code, message) => new host.PulseRuntimeContractError(code, message);

function normalizeBodyForwarding(value, maxDurationMs) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'maxBytes')
    || !Number.isSafeInteger(value.maxBytes) || value.maxBytes <= 0
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 30000) {
    throw error('PULSE_REQUEST_FORWARDING_CONFIG_INVALID', 'node.bodyForwarding requires a positive safe integer maxBytes and node.maxDurationMs (1–30000).');
  }
  return Object.freeze({ maxBytes: value.maxBytes });
}

// One retained host chunk, one pending read, no whole-body accumulation. The
// host chunk contract is checked before retaining it; slices are copied so a
// small outgoing chunk cannot keep an oversized backing allocation alive.
function boundedBody(source, maxBytes, signal, observe, onClose) {
  let reader, controller, pending, failure, offset = 0, ended = false, stopped = false;
  const metrics = { bytes: 0, maxSourceChunkBytes: 0, maxChunkBytes: 0, maxQueuedBytes: 0 };
  const release = () => { try { reader?.releaseLock(); } catch (_) {} };
  function stop(reason) {
    if (stopped || ended) return;
    failure ||= reason;
    stopped = true; pending = undefined;
    try { Promise.resolve(reader ? reader.cancel(reason) : source?.cancel(reason)).catch(() => {}).finally(release); } catch (_) {}
    try { reason ? controller.error(reason) : controller.close(); } catch (_) {}
    signal?.removeEventListener('abort', abort);
    onClose?.();
  }
  const abort = () => stop(signal.reason);
  const stream = new ReadableStream({
    start(value) { controller = value; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); },
    async pull(value) {
      if (stopped || ended) return;
      try {
        signal?.throwIfAborted();
        if (!pending) {
          if (!source) { ended = true; value.close(); signal?.removeEventListener('abort', abort); onClose?.(); return; }
          reader ||= source.getReader();
          const next = await reader.read();
          if (stopped) return;
          signal?.throwIfAborted();
          if (next.done) { ended = true; value.close(); release(); signal?.removeEventListener('abort', abort); onClose?.(); return; }
          if (!(next.value instanceof Uint8Array) || next.value.byteLength > QUEUE_BYTES
            || next.value.buffer.byteLength > QUEUE_BYTES) {
            throw error('PULSE_REQUEST_FORWARDING_CHUNK_INVALID', 'Provider body chunks and their backing allocations must not exceed 65536 bytes.');
          }
          metrics.bytes += next.value.byteLength;
          if (metrics.bytes > maxBytes) throw error('PULSE_REQUEST_BODY_TOO_LARGE', 'Forwarded body exceeds the configured transfer limit.');
          pending = next.value; offset = 0;
          metrics.maxSourceChunkBytes = Math.max(metrics.maxSourceChunkBytes, pending.byteLength);
          metrics.maxQueuedBytes = Math.max(metrics.maxQueuedBytes, pending.byteLength);
        }
        const count = Math.min(CHUNK_BYTES, pending.byteLength - offset);
        if (count) {
          value.enqueue(Uint8Array.from(pending.subarray(offset, offset + count)));
          metrics.maxChunkBytes = Math.max(metrics.maxChunkBytes, count);
        }
        offset += count;
        if (offset === pending.byteLength) pending = undefined;
        observe?.(Object.freeze({ ...metrics }));
      } catch (cause) { stop(cause); }
    },
    cancel(reason) { stop(reason); }
  }, { highWaterMark: 0 });
  return { stream, stop, metrics, get failure() { return failure; } };
}

function createIncomingBody(request, options) {
  const policy = normalizeBodyForwarding(options.bodyForwarding, options.maxDurationMs);
  if (!policy) return undefined;
  let upload, timeoutMs, timer, responseSignal, responseTransferred = false;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  function validate() {
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
      throw error('PULSE_REQUEST_FORWARDING_HEADERS_INVALID', 'Invalid incoming content length.');
    }
    if (length !== null && Number(length) > policy.maxBytes) throw error('PULSE_REQUEST_BODY_TOO_LARGE', 'Incoming body exceeds the configured transfer limit.');
  }
  validate();
  return host.createIncomingBodyOwnership({
    get responseSignal() { return responseSignal; },
    validate(init) {
      validate();
      if (init.method !== 'POST') throw error('PULSE_FETCH_BODY_METHOD_UNSUPPORTED', 'Incoming forwarding requires an outbound POST.');
      for (const [name] of init.headers) if (/^(host|content-length|transfer-encoding|connection|keep-alive|te|trailer|upgrade|proxy-connection)$/i.test(name)) {
        throw error('PULSE_REQUEST_FORWARDING_HEADERS_INVALID', 'The provider owns forwarding framing and hop-by-hop headers.');
      }
      if (typeof options.fetchImplementation !== 'function') throw error('PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE', 'Incoming forwarding requires provider-owned network transport.');
      timeoutMs = init.timeoutMs;
    },
    async forward(url, init, execution) {
      // The ordinary fetch effect settles at headers. Keep its shorter budget
      // through response-body completion for this single-use transfer.
      const timeout = new AbortController();
      if (timeoutMs !== undefined) timer = setTimeout(() => timeout.abort(error('PULSE_FETCH_TIMEOUT', 'Incoming forwarding exceeded its fetch timeout.')), Math.min(timeoutMs, options.maxDurationMs));
      const signal = AbortSignal.any([execution.signal, options.signal, timeout.signal].filter(Boolean));
      responseSignal = signal;
      upload = boundedBody(request.body, policy.maxBytes, signal, options.onBodyForwardingObservation);
      let response;
      try {
        response = await options.fetchImplementation(url, {
          method: 'POST', headers: init.headers, body: upload.stream,
          signal, duplex: 'half', redirect: 'manual'
        });
      } catch (cause) { clearTimer(); throw upload.failure || cause; }
      finally { upload.stop(); }
      if (signal.aborted) {
        clearTimer();
        try { void response?.body?.cancel(signal.reason).catch(() => {}); } catch (_) {}
        signal.throwIfAborted();
      }
      if (!(response instanceof Response)) throw error('PULSE_FETCH_RESPONSE_INVALID', 'Forwarding transport must return a Web Response.');
      if (response.status >= 300 && response.status < 400) {
        try { void response.body?.cancel().catch(() => {}); } catch (_) {}
        throw error('PULSE_REQUEST_FORWARDING_REDIRECT', 'Single-use incoming bodies cannot be replayed on redirects.');
      }
      const responseBody = response.body && boundedBody(response.body, policy.maxBytes, signal, options.onBodyForwardingObservation,
        () => { if (!options.responseWriterOwnsCompletion) clearTimer(); });
      responseTransferred = Boolean(responseBody);
      if (!responseBody && !options.responseWriterOwnsCompletion) clearTimer();
      // Headers and status remain provider-owned. No incoming request headers
      // are copied implicitly; the response bytes retain their ordinary form.
      return new Response(responseBody ? responseBody.stream : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
    cancel(reason) {
      if (!responseTransferred || options.responseWriterOwnsCompletion) clearTimer();
      upload?.stop(reason);
      if (!upload && request.body && !request.body.locked) void request.body.cancel(reason).catch(() => {});
      // Response ownership has transferred separately to the HTTP writer.
    }
  });
}

// Adapt IncomingMessage without switching it into flowing mode. Node's own
// transport buffer is separate from the Pulse queue and stays at most 64 KiB.
function nodeIncomingStream(request) {
  if (request.readableHighWaterMark > QUEUE_BYTES) throw error('PULSE_REQUEST_FORWARDING_CHUNK_INVALID', 'Incoming Node transport high-water mark exceeds 65536 bytes.');
  let stopped = false, wake;
  const notify = () => { wake?.(); wake = undefined; };
  for (const event of ['readable', 'end', 'error', 'aborted']) request.on(event, notify);
  function cleanup() { for (const event of ['readable', 'end', 'error', 'aborted']) request.removeListener(event, notify); }
  return new ReadableStream({
    async pull(controller) {
      while (!stopped) {
        if (request.errored || request.aborted) { cleanup(); throw request.errored || error('PULSE_NODE_REQUEST_READ_FAILED', 'Incoming request was aborted.'); }
        const chunk = request.read(Math.min(request.readableLength || CHUNK_BYTES, CHUNK_BYTES));
        if (chunk) { controller.enqueue(Uint8Array.from(chunk)); return; }
        if (request.readableEnded) { cleanup(); controller.close(); return; }
        await new Promise(resolve => { wake = resolve; });
      }
    },
    cancel() { stopped = true; request.pause(); cleanup(); notify(); }
  }, { highWaterMark: 0 });
}

module.exports = { normalizeBodyForwarding, boundedBody, createIncomingBody, nodeIncomingStream };
