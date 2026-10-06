#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-package-'));
const evidenceRoot = path.join(root, 'wasm/.test-results');
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidence = fs.mkdtempSync(path.join(evidenceRoot, 'mcp-package-'));
const report = { status: 'running', node: process.version, checks: [],
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() };
function run(command, args, cwd = temp, timeout = 30000) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_ignore_scripts: 'true', npm_config_fetch_retries: '0' } });
}
try {
  const [pack] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], path.join(root, 'packages/mcp')));
  const tarball = path.join(temp, pack.filename);
  const entries = readTarEntries(tarball);
  report.tarball = { sha256: crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'),
    bytes: fs.statSync(tarball).size, files: [...entries.keys()].sort() };
  const expected = ['package.json', 'README.md', 'LICENSE', 'NOTICE',
    ...fs.readdirSync(path.join(root, 'packages/mcp/src')).filter(file => /\.(js|d\.ts)$/.test(file)).map(file => `src/${file}`)];
  assert.deepEqual([...entries.keys()].sort(), expected.map(file => `package/${file}`).sort());
  for (const file of ['LICENSE', 'NOTICE']) assert.deepEqual(entries.get(`package/${file}`), fs.readFileSync(path.join(root, file)));
  const manifest = JSON.parse(entries.get('package/package.json'));
  assert.equal(manifest.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './node']);
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) {
    assert.equal(Object.keys(manifest[key] || {}).length, 0, `${key} must remain empty`);
  }
  report.checks.push('packed allowlist, root legal notices, two exports, zero runtime dependencies');

  const consumer = path.join(temp, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'pulse-mcp-packed-consumer', private: true }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer);
  const consumerRequire = createRequire(path.join(consumer, 'package.json'));
  assert.ok(!fs.lstatSync(path.join(consumer, 'node_modules/@pulse-compute/mcp')).isSymbolicLink());
  const assertions = `
assert.equal(PROTOCOL_VERSION, '2026-07-28');
assert.deepEqual(Object.keys(root).sort(), ['DEFAULT_LIMITS', 'PROTOCOL_VERSION', 'createMcpHttpHandler']);
assert.deepEqual(Object.keys(node).sort(), ['createMcpNodeHandler']);
assert.ok(Object.isFrozen(DEFAULT_LIMITS));
assert.equal(typeof createMcpHttpHandler().fetch, 'function');
const server = createServer(createMcpNodeHandler()); server.close();
`;
  fs.writeFileSync(path.join(consumer, 'consumer.cjs'), `
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const root = require('@pulse-compute/mcp');
const node = require('@pulse-compute/mcp/node');
const { createMcpHttpHandler, PROTOCOL_VERSION, DEFAULT_LIMITS } = root;
const { createMcpNodeHandler } = node;
${assertions}
assert.throws(() => require('@pulse-compute/mcp/src/index.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
assert.throws(() => require('@pulse-compute/mcp/package.json'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
`);
  fs.writeFileSync(path.join(consumer, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import root, { createMcpHttpHandler, PROTOCOL_VERSION, DEFAULT_LIMITS } from '@pulse-compute/mcp';
import node, { createMcpNodeHandler } from '@pulse-compute/mcp/node';
${assertions}
await assert.rejects(import('@pulse-compute/mcp/src/node.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
`);
  for (const file of ['consumer.cjs', 'consumer.mjs']) run(process.execPath, [file], consumer);
  report.checks.push('installed CommonJS and ESM public imports; implementation subpaths blocked');

  // Consumer development types come from the restored lockfile; never add runtime dependencies.
  fs.mkdirSync(path.join(consumer, 'node_modules/@types'), { recursive: true });
  const nodeTypes = require.resolve('@types/node/package.json');
  fs.cpSync(path.dirname(nodeTypes), path.join(consumer, 'node_modules/@types/node'), { recursive: true });
  const undiciTypes = createRequire(nodeTypes).resolve('undici-types/package.json');
  fs.cpSync(path.dirname(undiciTypes), path.join(consumer, 'node_modules/undici-types'), { recursive: true });
  const types = `
import { createServer } from 'node:http';
import { createMcpHttpHandler, PROTOCOL_VERSION, DEFAULT_LIMITS } from '@pulse-compute/mcp';
import type { McpHttpOptions, McpHttpHandler, McpToolsOptions, McpAuthorizationOptions, McpLimits } from '@pulse-compute/mcp';
import { createMcpNodeHandler } from '@pulse-compute/mcp/node';
const version: '2026-07-28' = PROTOCOL_VERSION;
const limits: Readonly<McpLimits> = DEFAULT_LIMITS;
const tools: McpToolsOptions = { catalog: {}, schemas: {}, routerId: 'rpc', target: 'node-javascript', endpoint: 'http://127.0.0.1:4000/' };
const authorization: McpAuthorizationOptions = { resource: 'https://mcp.example/mcp', issuer: 'https://issuer.example', introspectionEndpoint: 'https://issuer.example/introspect', clientId: 'host', clientSecret: 'fixture', scopes: ['read'], operations: { status: [] } };
const options: McpHttpOptions = { tools, authorization, limits: { deadlineMs: 1000 } };
const handler: Readonly<McpHttpHandler> = createMcpHttpHandler(options);
const response: Promise<Response> = handler.fetch(new Request('https://mcp.example/mcp'));
createServer(createMcpNodeHandler(options));
// @ts-expect-error implementation imports are outside the package surface
import internal from '@pulse-compute/mcp/src/index.js';
// @ts-expect-error the supported protocol literal is deliberate
const legacy: '2025-06-18' = PROTOCOL_VERSION;
// @ts-expect-error ceilings are immutable
DEFAULT_LIMITS.deadlineMs = 1;
`;
  for (const extension of ['cts', 'mts']) fs.writeFileSync(path.join(consumer, `consumer.${extension}`), types);
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', 'consumer.cts', 'consumer.mts'], consumer);
  report.toolchain = { typescript: require('typescript/package.json').version, nodeTypes: JSON.parse(fs.readFileSync(nodeTypes)).version };
  report.checks.push('strict NodeNext CommonJS and ESM declarations without source aliases or skipLibCheck');

  const client = path.join(temp, 'client'); fs.mkdirSync(client);
  for (const file of ['package.json', 'pnpm-lock.yaml', 'adapter-proof.mjs']) fs.copyFileSync(path.join(__dirname, 'reference', file), path.join(client, file));
  const pnpm = pnpmInvocation(root);
  run(pnpm.command, [...pnpm.prefix, 'install', '--frozen-lockfile', '--ignore-scripts'], client, 120000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(client, 'node_modules/@modelcontextprotocol/client/package.json'))).version, '2.2.0');
  run(process.execPath, ['adapter-proof.mjs', consumerRequire.resolve('@pulse-compute/mcp/node'), path.join(evidence, 'wire.json')], client, 15000);
  report.wire = JSON.parse(fs.readFileSync(path.join(evidence, 'wire.json')));
  assert.equal(report.wire.status, 'passed');
  report.checks.push('locked official client 2.2.0 repeated discovery against installed packed adapter');
  report.status = 'passed';
  console.log(`ok - MCP packed consumer qualification (${report.tarball.bytes} bytes); evidence ${evidence}`);
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error); console.error(error); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(evidence, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(temp, { recursive: true, force: true });
}
