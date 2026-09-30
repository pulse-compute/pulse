'use strict';

const { createIncomingBodyOwnership, PulseRuntimeContractError } = require('@pulse-compute/runtime/host');
const limits = Object.freeze({ inputBytes: 65536, outputBytes: 262144, expansion: 4, sourceChunkBytes: 65536, readBytes: 4093, textBytes: 4096, reads: 18 });
const error = (code, message) => new PulseRuntimeContractError(code, message);

function normalizeBodyTransform(value, options) {
  if (value === undefined) return undefined;
  if (value !== true || options.generatedOutput !== true || options.bodyForwarding !== undefined
    || !Number.isInteger(options.maxDurationMs) || options.maxDurationMs < 1 || options.maxDurationMs > 30000) {
    throw error('PULSE_TRANSFORM_CONFIG_INVALID', 'node.bodyTransform requires generatedOutput and maxDurationMs (1–30000), and excludes bodyForwarding.');
  }
  return true;
}

function createTransformInput(request, options) {
  try { return admitTransformInput(request, options); }
  catch (reason) {
    if (request.body && !request.body.locked) void request.body.cancel(reason).catch(() => {});
    throw reason;
  }
}

function admitTransformInput(request, options) {
  normalizeBodyTransform(options.bodyTransform, options);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw error('PULSE_TRANSFORM_HEADERS_INVALID', 'Invalid incoming content length.');
  if (length !== null && Number(length) > limits.inputBytes) throw error('PULSE_TRANSFORM_INPUT_LIMIT', 'Transform input exceeds 65536 bytes.');
  // Fatal decoding preserves a BOM as data and carries at most three UTF-8 bytes.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let reader, pending, offset = 0, ended = false, stopped = false, failure, reads = 0;
  const metrics = { inputBytes: 0, deliveredBytes: 0, maxSourceChunkBytes: 0, maxTextBytes: 0, maxQueuedBytes: 0 };
  function release() { try { reader?.releaseLock(); } catch (_) {} }
  function cancel(reason) {
    if (stopped) return;
    stopped = true; failure ||= reason; pending = undefined;
    try { Promise.resolve(reader ? reader.cancel(reason) : request.body?.cancel(reason)).catch(() => {}).finally(release); } catch (_) {}
  }
  return createIncomingBodyOwnership({
    validate() { throw error('PULSE_REQUEST_BODY_OWNERSHIP', 'Transform input cannot be forwarded.'); },
    forward() { throw error('PULSE_REQUEST_BODY_OWNERSHIP', 'Transform input cannot be forwarded.'); },
    cancel,
    async readTextChunk(budget) {
      if (stopped) throw failure || error('PULSE_TRANSFORM_CLOSED', 'Transform input is closed.');
      if (++reads > limits.reads) throw error('PULSE_TRANSFORM_READ_LIMIT', 'Transform input permits at most 18 reads, including EOF.');
      const removeAbort = budget.onAbort(() => cancel(budget.signal.reason));
      try {
        budget.check();
        // Fixed bounded blocks make chunk transforms independent of network fragmentation.
        const block = new Uint8Array(limits.readBytes);
        let used = 0;
        while (used < block.length && !ended) {
          if (!pending) {
            if (!request.body) { ended = true; break; }
            reader ||= request.body.getReader();
            const next = await budget.race(reader.read());
            budget.check();
            if (next.done) { ended = true; release(); break; }
            if (!(next.value instanceof Uint8Array) || next.value.byteLength > limits.sourceChunkBytes || next.value.buffer.byteLength > limits.sourceChunkBytes) {
              throw error('PULSE_TRANSFORM_CHUNK_INVALID', 'Transform source chunks and backing allocations must not exceed 65536 bytes.');
            }
            metrics.inputBytes += next.value.byteLength;
            if (metrics.inputBytes > limits.inputBytes) throw error('PULSE_TRANSFORM_INPUT_LIMIT', 'Transform input exceeds 65536 bytes.');
            pending = next.value; offset = 0;
            metrics.maxSourceChunkBytes = Math.max(metrics.maxSourceChunkBytes, pending.byteLength);
            metrics.maxQueuedBytes = Math.max(metrics.maxQueuedBytes, pending.byteLength + block.length + 3);
          }
          const count = Math.min(block.length - used, pending.byteLength - offset);
          block.set(pending.subarray(offset, offset + count), used);
          used += count; offset += count;
          if (offset === pending.byteLength) pending = undefined;
        }
        let text;
        try { text = decoder.decode(block.subarray(0, used), { stream: !ended }); }
        catch (_) { throw error('PULSE_TRANSFORM_UTF8_INVALID', 'Transform input must be valid UTF-8, including its final sequence.'); }
        const bytes = Buffer.byteLength(text);
        metrics.deliveredBytes += bytes;
        metrics.maxTextBytes = Math.max(metrics.maxTextBytes, bytes);
        options.onBodyTransformObservation?.(Object.freeze({ ...metrics, reads }));
        return Object.freeze({ done: ended && used === 0 && text.length === 0, text });
      } catch (reason) { cancel(reason); throw reason; }
      finally { removeAbort(); }
    }
  });
}

module.exports = { limits, normalizeBodyTransform, createTransformInput };
