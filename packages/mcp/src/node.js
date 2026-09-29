'use strict';

const { createMcpHttpHandler } = require('./index.js');

// Cancelling admission must stop reads without destroying the socket before
// its finite HTTP error can be sent. Node's generic toWeb cancellation destroys
// IncomingMessage, so this bridge owns the small paused stream explicitly.
function requestBody(req) {
  let detach;
  return new ReadableStream({
    start(controller) {
      const data = chunk => { controller.enqueue(chunk); req.pause(); };
      const end = () => { detach(); controller.close(); };
      const error = () => { detach(); controller.error(new Error('Request body interrupted')); };
      detach = () => {
        req.pause();
        req.removeListener('data', data); req.removeListener('end', end);
        req.removeListener('error', error); req.removeListener('aborted', error);
      };
      req.on('data', data); req.once('end', end);
      req.once('error', error); req.once('aborted', error); req.pause();
    },
    pull() { req.resume(); },
    cancel() { detach(); }
  });
}

/** Request listener only; owning application controls listen, shutdown and auth. */
function createMcpNodeHandler(options = {}) {
  const handler = createMcpHttpHandler(options);
  return async function mcpRequestListener(req, res) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once('aborted', abort);
    res.once('close', abort);
    // Headers/rawHeaders belong to this request. Do not derive routing origin
    // from an untrusted Host or forwarded header; this adapter owns only path.
    try {
      const headers = new Headers();
      for (let index = 0; index < req.rawHeaders.length; index += 2) headers.append(req.rawHeaders[index], req.rawHeaders[index + 1]);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) {
        res.writeHead(400, { 'cache-control': 'no-store', connection: 'close' }).end();
        return;
      }
      // Fetch forbids TRACE/CONNECT even as inputs. All non-POST methods share
      // the shell's 405 admission path, so represent those as a bodyless GET.
      const request = new Request('http://localhost' + req.url, { method: req.method === 'POST' ? 'POST' : 'GET', headers,
        signal: controller.signal, ...(req.method === 'POST' ? { body: requestBody(req), duplex: 'half' } : {}) });
      const response = await handler.fetch(request);
      if (res.destroyed) return;
      const outgoing = Object.fromEntries(response.headers);
      // Do not drain an unbounded rejected upload just to retain keep-alive.
      if (!req.complete) outgoing.connection = 'close';
      res.writeHead(response.status, outgoing);
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch {
      if (!res.destroyed && !res.headersSent) res.writeHead(400, { 'cache-control': 'no-store', connection: 'close' }).end();
      else if (!res.destroyed) res.destroy();
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', abort);
    }
  };
}

module.exports = { createMcpNodeHandler };
