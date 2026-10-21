'use strict';
// Client qualification only. The recording relay forwards bytes to actual Viceroy;
// it implements no MCP behavior and performs no header or protocol translation.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const modern = '2026-07-28', legacy = '2025-06-18';
const matrix = [
  { id: 'sdk-modern', kind: 'sdk', profile: modern, fixture: 'reference', package: '@modelcontextprotocol/client', version: '2.2.0' },
  { id: 'claude-modern', kind: 'claude', profile: modern, fixture: 'claude-reference', package: '@anthropic-ai/claude-code', version: '2.1.292' },
  { id: 'sdk-legacy', kind: 'sdk', profile: legacy, fixture: 'reference', package: '@modelcontextprotocol/client', version: '2.2.0' },
  { id: 'codex-legacy', kind: 'codex', profile: legacy, fixture: 'codex-reference', package: '@openai/codex', version: '0.160.1' }
];
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); fs.renameSync(file + '.tmp', file); }
function installedIdentity(directory) {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) { assert(fs.realpathSync(file).startsWith(directory + path.sep)); continue; }
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push([path.relative(directory, file), stat.size, hash(fs.readFileSync(file))]);
    }
  }
  walk(path.join(directory, 'node_modules'));
  return { files: files.length, bytes: files.reduce((n, x) => n + x[1], 0), sha256: hash(JSON.stringify(files)) };
}
function message(profile, method, params = {}, id = 1) {
  const isModern = profile === modern;
  return { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    ...(method === 'initialize' ? {} : { 'mcp-protocol-version': profile }),
    ...(isModern ? { 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}) } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, ...(isModern ? { _meta: {
    'io.modelcontextprotocol/protocolVersion': modern, 'io.modelcontextprotocol/clientCapabilities': {} } } : {}) } }) };
}
async function wireProfile(profile, exchange, cases) {
  const report = { profile, status: 'running', checks: [] };
  async function check(label, req, status, verify) {
    const response = await exchange(profile + ':' + label, req), text = response.body.toString();
    const body = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, label + ': ' + text);
    const headers = new Headers(response.headers);
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(headers.has('mcp-session-id'), false);
    assert.equal(headers.has('access-control-allow-origin'), false);
    verify?.(body); report.checks.push({ label, status, errorCode: body?.error?.code ?? null });
    return body;
  }
  try {
    const init = message(legacy, 'initialize', { protocolVersion: legacy, capabilities: {}, clientInfo: { name: 'wire-proof', version: '1' } }, 'init');
    await check('legacy-explicit', init, profile === modern ? 400 : 200, body => {
      if (profile === legacy) { assert.equal(body.id, 'init'); assert.equal(body.result.protocolVersion, legacy); assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } }); }
      else assert(body.error);
    });
    await check('modern-discovery', message(modern, 'server/discover'), 200, body => {
      assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
      assert.deepEqual(body.result.supportedVersions, [modern]);
    });
    if (profile === legacy) await check('legacy-ping', message(legacy, 'ping'), 200, body => assert.deepEqual(body.result, {}));
    for (const id of [0, -1, 9007199254740991, '', '雪', 'quote"\\\n']) {
      await check('id:' + JSON.stringify(id), message(profile, 'tools/list', {}, id), 200, body => assert.equal(body.id, id));
    }
    for (const id of [null, true, {}, [], 1.5, 9007199254740992]) await check('invalid-id:' + JSON.stringify(id), message(profile, 'tools/list', {}, id), 400, body => assert(body.error));
    for (const method of ['notifications/initialized', 'tools/call', 'unknown']) {
      const req = message(profile, method), body = JSON.parse(req.body); delete body.id;
      await check('notification:' + method, { ...req, body: JSON.stringify(body) }, 202, body => assert.equal(body, null));
    }
    for (const method of ['unknown', 'resources/list', 'prompts/list', 'logging/setLevel']) {
      await check('disabled:' + method, message(profile, method, {}, 'error-id'), 404, body => { assert.equal(body.id, 'error-id'); assert.equal(body.error.code, -32601); });
    }
    const base = message(profile, 'tools/list');
    for (const [label, req, status] of [
      ['origin', { ...base, headers: { ...base.headers, origin: 'https://untrusted.invalid' } }, 403],
      ['accept', { ...base, headers: { ...base.headers, accept: 'text/plain' } }, 406],
      ['type', { ...base, headers: { ...base.headers, 'content-type': 'text/plain' } }, 415],
      ['encoding', { ...base, headers: { ...base.headers, 'content-encoding': 'gzip' } }, 415],
      ['oversize', { ...base, body: ' '.repeat(32769) }, 413],
      ['malformed', { ...base, body: '{' }, 400], ['batch', { ...base, body: '[]' }, 400],
      ['depth', { ...base, body: '{"a":'.repeat(33) + '0' + '}'.repeat(33) }, 400],
      ['get', { method: 'GET', path: '/mcp' }, 405], ['path', { ...base, path: '/mcp/' }, 404],
    ]) await check(label, req, status);
    const modernRequest = message(modern, 'tools/list');
    for (const [label, mutate] of [
      ['missing-meta', (r,b) => delete b.params._meta],
      ['wrong-meta', (r,b) => b.params._meta['io.modelcontextprotocol/protocolVersion'] = legacy],
      ['missing-method', r => delete r.headers['mcp-method']],
      ['wrong-method', r => r.headers['mcp-method'] = 'ping'],
      ['wrong-protocol', r => r.headers['mcp-protocol-version'] = 'invalid'],
      ['mixed-legacy', r => r.headers['mcp-protocol-version'] = legacy],
    ]) {
      const req = structuredClone(modernRequest), body = JSON.parse(req.body); mutate(req, body); req.body = JSON.stringify(body);
      await check('no-fallback:' + label, req, 400, body => assert(body.error));
    }
    await check('unknown-tool', message(profile, 'tools/call', { name: 'unknown', arguments: {} }), 400, body => { assert.equal(body.error.code, -32602); });
    await check('tool-schema-error', message(profile, 'tools/call', { name: 'pulse.search', arguments: { version: cases[0].input.version, query: 42 } }), 200, body => { assert.equal(body.result.isError, true); assert.equal(body.result.structuredContent, undefined); });
    for (const c of cases) await check('recovery:' + c.tool, message(profile, 'tools/call', { name: c.tool, arguments: c.input }), 200, body => assert.deepEqual(body.result.structuredContent, c.expected));
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack; }
  return report;
}
async function recordingRelay(endpoint, wire) {
  const errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks); assert(bytes.length <= 65536);
      let request; try { request = JSON.parse(bytes); } catch {}
      const upstream = http.request(new URL(req.url, endpoint), { method: req.method, headers: req.headers, timeout: 10000 }, response => {
        const chunks = []; response.on('data', b => chunks.push(b));
        response.on('end', () => {
          const body = Buffer.concat(chunks); let decoded; try { decoded = JSON.parse(body); } catch {}
          wire.push({ httpMethod: req.method, path: req.url, request, requestHeaders: req.headers,
            requestSha256: hash(bytes), status: response.statusCode, responseHeaders: response.headers,
            response: decoded ?? null, responseSha256: hash(body), responseBytes: body.length });
          res.writeHead(response.statusCode, response.headers).end(body);
        });
        response.on('error', error => { errors.push(error.message); res.destroy(error); });
      });
      upstream.on('timeout', () => upstream.destroy(Error('Viceroy request timed out')));
      upstream.on('error', error => { errors.push(error.message); res.destroy(error); }); upstream.end(bytes);
    } catch (error) { errors.push(error.message); res.destroy(error); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { endpoint: `http://127.0.0.1:${server.address().port}/mcp`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []);
  } };
}
function assertWire(row, cases) {
  const wire = row.wire;
  const successful = method => wire.filter(x => x.request?.method === method && x.status === 200);
  for (const x of wire) {
    assert.equal(x.responseHeaders['mcp-session-id'], undefined);
    assert.equal(x.responseHeaders['cache-control'], 'no-store');
    if (x.response) assert.equal(x.response.id, x.request?.id);
  }
  assert(successful('tools/list').length);
  for (const c of cases) {
    const calls = successful('tools/call').filter(x => x.request.params.name === c.tool);
    assert(calls.length, 'Missing tool call: ' + c.tool);
    for (const x of calls) {
      assert.equal(x.response.result.isError, false);
      assert.deepEqual(x.request.params.arguments, c.input);
      assert.deepEqual(x.response.result.structuredContent, c.expected);
      assert.deepEqual(JSON.parse(x.response.result.content.find(item => item.type === 'text').text), c.expected);
    }
  }
  const handshake = successful(row.profile === modern ? 'server/discover' : 'initialize'); assert(handshake.length);
  for (const x of handshake) assert.deepEqual(x.response.result.capabilities, { tools: { listChanged: false } });
  if (row.profile === modern) {
    assert(!wire.some(x => x.request?.method === 'initialize'), 'Modern failure must not fall back to initialization');
    for (const x of wire.filter(x => x.httpMethod === 'POST' && x.request?.id !== undefined)) {
      assert.equal(x.requestHeaders['mcp-protocol-version'], modern);
      assert.equal(x.requestHeaders['mcp-method'], x.request.method);
      assert.equal(x.request.params._meta['io.modelcontextprotocol/protocolVersion'], modern);
      assert(x.request.params._meta['io.modelcontextprotocol/clientCapabilities']);
      if (x.request.method === 'tools/call') assert.equal(x.requestHeaders['mcp-name'], x.request.params.name);
    }
  } else {
    assert(!wire.some(x => x.request?.method === 'server/discover'));
    for (const x of handshake) assert.equal(x.request.params.protocolVersion, legacy);
    assert(wire.some(x => x.request?.method === 'notifications/initialized' && x.status === 202));
  }
}
function createSuite({ temporary, root, run, env, output, source }) {
  const report = { schemaVersion: 'pulse.context-fastly-clients.v1', status: 'running', deployed: false,
    source, node: process.version, platform: process.platform, arch: process.arch,
    fixtureFiles: Object.fromEntries(['context-fastly-clients.cjs', 'reference/native-client-proof.cjs'].map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
    transport: 'byte-preserving loopback recording relay to actual Fastly CLI/Viceroy; no MCP translation',
    rows: matrix.map(row => ({ ...row, source, status: 'pending', wire: [] })), profiles: [] };
  const installed = new Map();
  function persist() {
    save(path.join(output, 'qualification.json'), report);
    for (const row of report.rows) save(path.join(output, row.id + '.json'), row);
  }
  persist();
  return { report,
    async prepare() {
      const pnpm = pnpmInvocation(root);
      for (const row of report.rows) {
        if (installed.has(row.fixture)) continue;
        const directory = path.join(temporary, 'client-' + row.fixture); fs.mkdirSync(directory);
        const record = { directory };
        installed.set(row.fixture, record);
        try {
          for (const file of ['package.json', 'pnpm-lock.yaml']) fs.copyFileSync(path.join(__dirname, row.fixture, file), path.join(directory, file));
          record.lockSha256 = hash(fs.readFileSync(path.join(directory, 'pnpm-lock.yaml')));
          await run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: directory, timeout: 120000 });
          assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'node_modules', row.package, 'package.json'))).version, row.version);
          record.identity = installedIdentity(directory);
          record.executable = row.kind === 'codex' ? path.join(directory, 'node_modules/.bin/codex') : row.kind === 'claude' ? path.join(directory, 'node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs') : null;
        } catch (error) { record.error = error.message; }
      }
      for (const row of report.rows) {
        const record = installed.get(row.fixture);
        row.client = { package: row.package, version: row.version, lockSha256: record.lockSha256, installed: record.identity ?? null };
        if (record.error) { row.status = 'blocked'; row.error = record.error; }
      }
      persist();
    },
    async qualify({ profile, endpoint, exchange, cases, artifact, hostTools }) {
      const boundArtifact = { hostTools, name: artifact.name, moduleSha256: artifact.moduleSha256, moduleBytes: artifact.moduleBytes,
        configSha256: artifact.configSha256, applicationEntrySha256: artifact.applicationEntrySha256, receipts: artifact.receipts };
      report.profiles.push({ ...await wireProfile(profile, exchange, cases), artifact: boundArtifact }); persist();
      for (const row of report.rows.filter(r => r.profile === profile)) {
        row.artifact = boundArtifact; row.expectedSha256 = hash(JSON.stringify(cases));
        if (row.status === 'blocked') { persist(); continue; }
        const record = installed.get(row.fixture), proofFile = path.join(output, row.id + '-client.json');
        const settingsFile = path.join(temporary, row.id + '.json');
        const relay = await recordingRelay(endpoint, row.wire);
        row.status = 'running'; persist();
        try {
          save(settingsFile, { kind: row.kind, profile, endpoint: relay.endpoint, cases, directory: record.directory,
            home: path.join(output, row.id + '-home'), executable: record.executable, reportFile: proofFile });
          await run(process.execPath, [path.join(__dirname, 'reference/native-client-proof.cjs'), settingsFile], { cwd: record.directory, timeout: 45000 });
          row.proof = JSON.parse(fs.readFileSync(proofFile)); assert.equal(row.proof.status, 'passed');
          assertWire(row, cases);
          assert.deepEqual(installedIdentity(record.directory), record.identity, 'Client installation changed during qualification');
          row.client.unchanged = true; row.status = 'passed';
        } catch (error) { row.status = 'failed'; row.error = error.message; if (fs.existsSync(proofFile)) row.proof = JSON.parse(fs.readFileSync(proofFile)); }
        finally { try { await relay.close(); } catch (error) { row.status = 'failed'; row.error = error.stack; } persist(); }
      }
    },
    assertPassed() {
      assert.equal(report.profiles.length, 2);
      assert(report.profiles.every(p => p.status === 'passed'), 'Protocol profile qualification failed');
      assert(report.rows.every(r => r.status === 'passed'), 'Pinned client qualification failed or blocked');
    },
    finish(status, error) {
      for (const row of report.rows) if (['pending', 'running'].includes(row.status)) { row.status = 'blocked'; row.error = error || 'Prerequisite did not complete'; }
      report.status = status === 'passed' && report.rows.every(row => row.status === 'passed') && report.profiles.length === 2 && report.profiles.every(p => p.status === 'passed') ? 'passed' : 'failed'; persist();
    }
  };
}
module.exports = { createSuite, matrix, message, assertWire };
