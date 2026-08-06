#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const USERS = new Map([
  ['abc', { id: 'abc', name: 'Ada Lovelace', active: true }],
  ['123', { id: '123', name: 'Grace Hopper', active: true }]
]);

const POSTS = new Map([
  ['abc', [
    { id: 'post-1', title: 'PulseWasm lifecycle' },
    { id: 'post-2', title: 'Provider-owned effects' }
  ]],
  ['123', [
    { id: 'post-3', title: 'Reference app ergonomics' }
  ]]
]);

function jsonResponse(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(text);
}

function emptyResponse(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function createReferenceOriginState() {
  const events = [];
  return {
    events,
    record(req, url, method) {
      const event = {
        method,
        path: url.pathname,
        url: url.pathname + url.search,
        headers: { ...req.headers },
        contentType: String(req.headers['content-type'] || ''),
        bodyRead: false,
        body: ''
      };
      events.push(event);
      return event;
    },
    stats() {
      return {
        requestCount: events.length,
        bodyReadCount: events.filter((event) => event.bodyRead).length,
        postBodies: events.filter((event) => event.method === 'POST').map((event) => ({ path: event.path, body: event.body, contentType: event.contentType })),
        methods: events.map((event) => event.method),
        paths: events.map((event) => event.path),
        contentTypes: events.map((event) => event.contentType).filter(Boolean)
      };
    },
    reset() {
      events.length = 0;
    }
  };
}

function readRequestBody(req, event) {
  if (event) event.bodyRead = true;
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      if (event) event.body = text;
      resolve(text);
    });
    req.on('error', reject);
  });
}

function userForId(id) {
  if (USERS.has(id)) return USERS.get(id);
  return undefined;
}

function postsForId(id) {
  return POSTS.get(id) || [];
}

async function handleReferenceOriginRequest(req, res, state) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const method = String(req.method || 'GET').toUpperCase();
  const event = state && typeof state.record === 'function' ? state.record(req, url, method) : undefined;

  if (url.pathname === '/health' && method === 'GET') {
    jsonResponse(res, 200, { ok: true, service: 'pulsewasm-reference-origin' }, { 'x-reference-origin': 'health' });
    return;
  }

  if (url.pathname === '/status/404' && method === 'GET') {
    jsonResponse(res, 404, { error: 'not_found', path: '/status/404' }, { 'x-reference-origin': 'status-404' });
    return;
  }

  const userMatch = url.pathname.match(/^\/users\/([^/]+)$/);
  if (userMatch && (method === 'GET' || method === 'HEAD')) {
    const id = decodeURIComponent(userMatch[1]);
    const user = userForId(id);
    if (!user) {
      if (method === 'HEAD') {
        emptyResponse(res, 404, {
          'content-type': 'application/json; charset=utf-8',
          'x-reference-origin': 'user',
          'x-user-id': id
        });
      } else {
        jsonResponse(res, 404, { error: 'not_found', id }, { 'x-reference-origin': 'user', 'x-user-id': id });
      }
      return;
    }
    if (method === 'HEAD') {
      emptyResponse(res, 200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-reference-origin': 'user',
        'x-user-id': id
      });
      return;
    }
    jsonResponse(res, 200, user, { 'x-reference-origin': 'user', 'x-user-id': id });
    return;
  }

  const postsMatch = url.pathname.match(/^\/users\/([^/]+)\/posts$/);
  if (postsMatch && (method === 'GET' || method === 'HEAD')) {
    const id = decodeURIComponent(postsMatch[1]);
    const posts = postsForId(id);
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-reference-origin': 'posts',
      'x-user-id': id,
      'x-count': String(posts.length)
    };
    if (method === 'HEAD') {
      emptyResponse(res, 200, headers);
      return;
    }
    jsonResponse(res, 200, posts, headers);
    return;
  }

  if (url.pathname === '/users' && method === 'POST') {
    const text = await readRequestBody(req, event);
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_) {
      jsonResponse(res, 400, { error: 'invalid_json' }, { 'x-reference-origin': 'create-user' });
      return;
    }
    const id = String(payload.id || 'created');
    const user = { id, name: String(payload.name || 'Created User'), active: payload.active !== false };
    USERS.set(id, user);
    if (!POSTS.has(id)) POSTS.set(id, []);
    jsonResponse(res, 201, user, { 'x-reference-origin': 'create-user', 'x-user-id': id });
    return;
  }

  jsonResponse(res, 404, { error: 'not_found', path: url.pathname }, { 'x-reference-origin': 'miss' });
}

function startReferenceNodeOrigin(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 0);
  const state = options.state || createReferenceOriginState();
  const server = http.createServer((req, res) => {
    handleReferenceOriginRequest(req, res, state).catch((error) => {
      jsonResponse(res, 500, { error: 'origin_error', message: error && error.message ? error.message : String(error) }, { 'x-reference-origin': 'error' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const url = `http://${address.address}:${address.port}`;
      resolve({
        server,
        host: address.address,
        port: address.port,
        url,
        events: state.events,
        get metrics() { return state.stats(); },
        stats: () => state.stats(),
        get metrics() { return state.stats(); },
        reset: () => state.reset(),
        close() {
          return new Promise((closeResolve, closeReject) => {
            let settled = false;
            const finish = (error) => {
              if (settled) return;
              settled = true;
              if (timer && typeof timer[Symbol.dispose] === 'function') timer[Symbol.dispose]();
              else clearTimeout(timer);
              if (error) closeReject(error);
              else closeResolve();
            };
            const timer = setTimeout(() => {
              if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
              finish();
            }, 1000);
            if (typeof timer.unref === 'function') timer.unref();
            server.close((error) => finish(error));
            setImmediate(() => {
              if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
              if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            });
          });
        }
      });
    });
  });
}

module.exports = {
  startReferenceNodeOrigin,
  handleReferenceOriginRequest,
  createReferenceOriginState,
  USERS,
  POSTS
};

if (require.main === module) {
  startReferenceNodeOrigin({ port: Number(process.env.PORT || 0) }).then((origin) => {
    console.log(JSON.stringify({ url: origin.url, pid: process.pid }));
    const stop = () => origin.close().finally(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
