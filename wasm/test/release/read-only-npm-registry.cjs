#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

const REGISTRY_VERSION = 'pulse.read-only-npm-registry.v1';
const READY_EVENT_VERSION = 'pulse.read-only-npm-registry-ready.v1';

function nullTerminatedString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero < 0 ? slice.length : zero).toString('utf8');
}

function octalNumber(buffer, start, length) {
  const value = nullTerminatedString(buffer, start, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function readTarballManifest(file) {
  const archive = zlib.gunzipSync(fs.readFileSync(file));
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = nullTerminatedString(header, 0, 100);
    const prefix = nullTerminatedString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = octalNumber(header, 124, 12);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > archive.length) throw new Error(`Truncated npm tarball entry ${fullName} in ${file}.`);
    if (fullName === 'package/package.json' || fullName === 'package.json') {
      const manifest = JSON.parse(archive.subarray(bodyStart, bodyEnd).toString('utf8'));
      if (!manifest || typeof manifest.name !== 'string' || !manifest.name) throw new Error(`Packed package ${file} has no name.`);
      if (typeof manifest.version !== 'string' || !manifest.version) throw new Error(`Packed package ${file} has no version.`);
      return manifest;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Packed package ${file} does not contain package/package.json.`);
}

function packageRecord(file) {
  const absolute = path.resolve(file);
  const bytes = fs.readFileSync(absolute);
  const manifest = readTarballManifest(absolute);
  const id = crypto.createHash('sha256').update(`${manifest.name}\0${manifest.version}\0`).update(bytes).digest('hex');
  return Object.freeze({
    id,
    file: absolute,
    name: manifest.name,
    version: manifest.version,
    manifest: Object.freeze(manifest),
    size: bytes.length,
    shasum: crypto.createHash('sha1').update(bytes).digest('hex'),
    integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`
  });
}

function catalogFromTarballs(files) {
  const records = files.map(packageRecord).sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const packages = new Map();
  const tarballs = new Map();
  for (const record of records) {
    let versions = packages.get(record.name);
    if (!versions) {
      versions = new Map();
      packages.set(record.name, versions);
    }
    if (versions.has(record.version)) throw new Error(`Duplicate package ${record.name}@${record.version} in read-only registry input.`);
    versions.set(record.version, record);
    tarballs.set(record.id, record);
  }
  return Object.freeze({ records: Object.freeze(records), packages, tarballs });
}

function packument(catalog, name, baseUrl) {
  const versions = catalog.packages.get(name);
  if (!versions) return null;
  const ordered = [...versions.values()].sort((left, right) => left.version.localeCompare(right.version));
  const latest = ordered[ordered.length - 1].version;
  return Object.freeze({
    name,
    'dist-tags': Object.freeze({ latest }),
    versions: Object.freeze(Object.fromEntries(ordered.map((record) => [record.version, Object.freeze({
      ...record.manifest,
      name: record.name,
      version: record.version,
      dist: Object.freeze({
        tarball: `${baseUrl}/tarballs/${record.id}.tgz`,
        shasum: record.shasum,
        integrity: record.integrity
      })
    })])))
  });
}

function sendJson(response, status, value, headOnly) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(body.length),
    'cache-control': 'no-store'
  });
  response.end(headOnly ? undefined : body);
}

function createReadOnlyRegistry(catalog) {
  const requests = {
    total: 0,
    packuments: 0,
    tarballs: 0,
    rejected: 0,
    missing: 0,
    missingPackuments: {},
    missingTarballs: 0
  };
  const server = http.createServer((request, response) => {
    requests.total += 1;
    const method = request.method || 'GET';
    const headOnly = method === 'HEAD';
    if (method !== 'GET' && !headOnly) {
      requests.rejected += 1;
      response.setHeader('allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'read-only-registry', method }, headOnly);
      return;
    }

    const host = request.headers.host || '127.0.0.1';
    const baseUrl = `http://${host}`;
    const url = new URL(request.url || '/', baseUrl);
    if (url.pathname === '/-/ping' || url.pathname === '/health') {
      sendJson(response, 200, { version: REGISTRY_VERSION, status: 'ok', packages: catalog.records.length }, headOnly);
      return;
    }

    const tarballMatch = /^\/tarballs\/([0-9a-f]{64})\.tgz$/.exec(url.pathname);
    if (tarballMatch) {
      const record = catalog.tarballs.get(tarballMatch[1]);
      if (!record) {
        requests.missing += 1;
        requests.missingTarballs += 1;
        sendJson(response, 404, { error: 'tarball-not-found' }, headOnly);
        return;
      }
      requests.tarballs += 1;
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(record.size),
        'cache-control': 'no-store',
        etag: `"${record.id}"`
      });
      if (headOnly) response.end();
      else fs.createReadStream(record.file).pipe(response);
      return;
    }

    let packageName;
    try { packageName = decodeURIComponent(url.pathname.slice(1).replace(/\/$/, '')); }
    catch (_) { packageName = ''; }
    const value = packageName && packument(catalog, packageName, baseUrl);
    if (!value) {
      requests.missing += 1;
      requests.missingPackuments[packageName || '<empty>'] =
        (requests.missingPackuments[packageName || '<empty>'] || 0) + 1;
      sendJson(response, 404, { error: 'package-not-found', package: packageName || null }, headOnly);
      return;
    }
    requests.packuments += 1;
    sendJson(response, 200, value, headOnly);
  });
  return Object.freeze({ server, requests });
}

function parseArgs(argv) {
  const files = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--package') {
      const value = argv[index + 1];
      if (!value) throw new Error('--package requires a tarball path.');
      files.push(value);
      index += 1;
      continue;
    }
    if (token.startsWith('--package=')) {
      files.push(token.slice('--package='.length));
      continue;
    }
    if (token === '--help' || token === '-h') return Object.freeze({ help: true, files: Object.freeze([]) });
    throw new Error(`Unknown read-only registry option ${token}.`);
  }
  if (files.length === 0) throw new Error('At least one --package tarball is required.');
  return Object.freeze({ help: false, files: Object.freeze(files) });
}

function usage() {
  return [
    'Usage: node read-only-npm-registry.cjs --package <package.tgz> [--package <package.tgz> ...]',
    '',
    'Serves exact package packuments and tarballs over a loopback-only, read-only npm registry.'
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const catalog = catalogFromTarballs(options.files);
  const registry = createReadOnlyRegistry(catalog);
  await new Promise((resolve, reject) => {
    registry.server.once('error', reject);
    registry.server.listen(0, '127.0.0.1', resolve);
  });
  const address = registry.server.address();
  const url = `http://127.0.0.1:${address.port}`;
  process.stdout.write(`${JSON.stringify({
    event: 'ready',
    version: READY_EVENT_VERSION,
    registryVersion: REGISTRY_VERSION,
    url,
    packages: catalog.records.map((entry) => `${entry.name}@${entry.version}`)
  })}\n`);

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    registry.server.close(() => {
      process.stderr.write(`${JSON.stringify({ event: 'closed', version: REGISTRY_VERSION, requests: registry.requests })}\n`);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = Object.freeze({
  REGISTRY_VERSION,
  READY_EVENT_VERSION,
  readTarballManifest,
  packageRecord,
  catalogFromTarballs,
  packument,
  createReadOnlyRegistry
});
