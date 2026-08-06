#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { initProject } = require('../../packages/cli/src/project-execution.js');
const { run, parseJson, listen, request, waitForJsonEvent, waitForClose, spawnDev, closeServer } = require('./helpers.cjs');

function writeProxySource(projectRoot, baseUrl) {
  fs.writeFileSync(
    path.join(projectRoot, 'src', 'index.ts'),
    `import type { PulseContext } from '@pulse-compute/runtime';\nexport default async function handler(ctx: PulseContext) { return ctx.fetch('${baseUrl}/data'); }\n`
  );
}

function writeWatchSource(projectRoot, value) {
  fs.writeFileSync(
    path.join(projectRoot, 'src', 'index.ts'),
    `import type { PulseContext } from '@pulse-compute/runtime';\nexport default async function handler(ctx: PulseContext) { return ctx.text(${JSON.stringify(value)}); }\n`
  );
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-dev-'));
  const projectRoot = path.join(tmpRoot, 'dev-pulse');
  const fastlyRoot = path.join(tmpRoot, 'fastly-dev-pulse');
  const children = new Set();
  const originSockets = new Set();
  let origin;
  try {
    parseJson(run(['init', projectRoot, '--json'], tmpRoot));
    origin = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ source: 'live-origin', path: req.url }));
    });
    origin.on('connection', (socket) => { originSockets.add(socket); socket.once('close', () => originSockets.delete(socket)); });
    const address = await listen(origin);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    writeProxySource(projectRoot, baseUrl);

    const onceDev = spawnDev(['dev', '--host', '0.0.0.0', '--port', '0', '--no-watch', '--once', '--json'], projectRoot, children);
    const ready = await waitForJsonEvent(onceDev.child, 'ready', onceDev.stderrText);
    assert.equal(ready.provider, 'node');
    assert.equal(ready.once, true);
    assert.equal(ready.watch, false);
    assert.equal(ready.host, '0.0.0.0');
    assert.match(ready.url, /^http:\/\/127\.0\.0\.1:/);
    const live = await request(`${ready.url}/from-dev`);
    assert.equal(live.status, 200, onceDev.stderrText());
    assert.deepEqual(JSON.parse(live.body), { source: 'live-origin', path: '/data' });
    await waitForClose(onceDev.child, onceDev.stderrText);

    initProject(fastlyRoot, { provider: 'fastly', name: 'pulse-fastly-dev' });
    writeProxySource(fastlyRoot, baseUrl);
    const fastlyConfigFile = path.join(fastlyRoot, '.pulse', 'config.ts');
    fs.writeFileSync(
      fastlyConfigFile,
      fs.readFileSync(fastlyConfigFile, 'utf8')
        .replace("dev: { host: '127.0.0.1', port: 8787 },", "dev: { host: '127.0.0.1', port: 8787, networkFetch: true, watch: false },")
        .replace('dynamicBackends: false', 'dynamicBackends: true')
    );
    const fastlyDev = spawnDev(['dev', '--port', '0', '--no-watch', '--once', '--json'], fastlyRoot, children);
    const fastlyReady = await waitForJsonEvent(fastlyDev.child, 'ready', fastlyDev.stderrText);
    assert.equal(fastlyReady.provider, 'fastly');
    assert.equal(fastlyReady.once, true);
    assert.equal(fastlyReady.watch, false);
    assert.equal(fastlyReady.project.providerConfig.providerSpecificUserland, false);
    const fastlyLive = await request(`${fastlyReady.url}/from-fastly-dev`);
    assert.equal(fastlyLive.status, 200, fastlyDev.stderrText());
    assert.deepEqual(JSON.parse(fastlyLive.body), { source: 'live-origin', path: '/data' });
    await waitForClose(fastlyDev.child, fastlyDev.stderrText);

    writeWatchSource(projectRoot, 'watch-v1');
    const watched = spawnDev(['dev', '--port', '0', '--watch', '--json'], projectRoot, children);
    const watchReady = await waitForJsonEvent(watched.child, 'ready', watched.stderrText);
    assert.equal(watchReady.watch, true);
    assert.equal((await request(`${watchReady.url}/watch`)).body, 'watch-v1');
    const reloadedEvent = waitForJsonEvent(watched.child, 'reloaded', watched.stderrText);
    writeWatchSource(projectRoot, 'watch-v2');
    const reloaded = await reloadedEvent;
    assert.equal(reloaded.entry, 'src/index.ts');
    assert.equal((await request(`${watchReady.url}/watch`)).body, 'watch-v2');
    watched.child.kill('SIGTERM');
    await waitForClose(watched.child, watched.stderrText);

    console.log('ok - pulse dev serves generated conventional Node/Fastly projects with live host fetch, wildcard-host reachability, one-request mode, graceful shutdown, and debounced source reload');
  } finally {
    for (const child of children) { try { child.kill('SIGKILL'); } catch (_) { /* best effort */ } }
    await closeServer(origin, originSockets);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
