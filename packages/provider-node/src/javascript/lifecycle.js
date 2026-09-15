'use strict';

const http = require('node:http');
const { createNodeJavascriptHandler } = require('./node-adapter.js');

const NODE_JAVASCRIPT_LIFECYCLE_VERSION = 'pulse.node-javascript-lifecycle.v1';

function statusForError(error) {
  if (['PULSE_REQUEST_DEADLINE_EXCEEDED', 'PULSE_REQUEST_CLOCK_INVALID'].includes(error?.code)) return 504;
  if (error && error.code === 'PULSE_REQUEST_BODY_TOO_LARGE') return 413;
  if (error && error.code === 'PULSE_NODE_REQUEST_READ_FAILED') return 400;
  return 500;
}

function writeSafeError(response, error) {
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  response.statusCode = statusForError(error);
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  if (response.statusCode === 504) response.setHeader('connection', 'close');
  response.end(response.statusCode === 504 ? 'Gateway Timeout' : response.statusCode === 413 ? 'Payload Too Large' : (response.statusCode === 400 ? 'Bad Request' : 'Internal Server Error'));
}

function createNodeJavascriptServer(application, options = {}) {
  const handler = createNodeJavascriptHandler(application, options);
  return http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      writeSafeError(response, error);
      if (typeof options.onError === 'function') options.onError(error, Object.freeze({ request, response }));
    });
  });
}

async function listenNodeJavascriptApplication(application, options = {}) {
  const server = createNodeJavascriptServer(application, options);
  const host = options.host || options.hostname || '127.0.0.1';
  const port = options.port === undefined ? 0 : Number(options.port);
  await new Promise((resolve, reject) => {
    function cleanup() {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
    }
    function onListening() {
      cleanup();
      resolve();
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, host);
  });
  return server;
}

function closeNodeJavascriptServer(server) {
  if (!server || typeof server.close !== 'function' || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_LIFECYCLE_VERSION,
  closeNodeJavascriptServer,
  createNodeJavascriptServer,
  listenNodeJavascriptApplication,
  statusForError
});
