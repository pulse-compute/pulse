'use strict';

class AdmissionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function checkDepth(text, maxDepth) {
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (++depth > maxDepth) throw new AdmissionError(400, -32600, 'Request nesting limit exceeded');
    } else if (char === '}' || char === ']') depth--;
  }
}

async function readBody(request, limits, signal) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  let aborted;
  const onAbort = () => {
    aborted = new AdmissionError(408, -32600, 'Request interrupted');
    // Cancellation may be asynchronous; an uncooperative source must not hold
    // admission open. Observe its rejection without waiting for its cleanup.
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (aborted) throw aborted;
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new AdmissionError(400, -32700, 'Invalid request body');
      bytes += next.value.byteLength;
      if (bytes > limits.maxRequestBytes) throw new AdmissionError(413, -32600, 'Request body limit exceeded');
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof AdmissionError) throw error;
    throw new AdmissionError(400, -32700, 'Invalid request body');
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

module.exports = { AdmissionError, checkDepth, readBody };
