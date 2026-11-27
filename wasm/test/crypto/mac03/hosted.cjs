'use strict';
// Read-only Fastly inspection and proof requests. Never provisions secrets,
// uploads packages, creates versions or activates a service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { load, hash } = require('./bundle.cjs');
const { bearer } = require('./fixture.cjs');
const { readTarEntries } = require('../../../../scripts/pack-release.cjs');

function cases(key) {
  const message = 'mac03:' + randomBytes(24).toString('hex') + ':é\r\n\0😀\ufeff';
  const sign = text => createHmac('sha256', key).update(text, 'utf8').digest('hex');
  const tag = sign(message);
  const rows = [{ id: 'valid', message, tag, expected: 'valid' },
    { id: 'changed-message', message: message + '!', tag, expected: 'invalid-authenticator' },
    { id: 'changed-key', message, tag: createHmac('sha256', Buffer.alloc(32, key[0] ^ 255)).update(message).digest('hex'), expected: 'invalid-authenticator' }];
  for (const byte of [0, 15, 31]) { const changed = Buffer.from(tag, 'hex'); changed[byte] ^= 1; rows.push({ id: `tag-byte-${byte}`, message, tag: changed.toString('hex'), expected: 'invalid-authenticator' }); }
  for (const [id, bad] of [['uppercase', tag.toUpperCase()], ['short', tag.slice(2)], ['nonhex', 'g' + tag.slice(1)], ['missing', '']]) rows.push({ id: `tag-${id}`, message, tag: bad, expected: 'invalid-input' });
  for (const [id, text, expected] of [['maximum-nul', '\0'.repeat(65536), 'valid'], ['maximum-multibyte', '😀'.repeat(16384), 'valid'], ['oversize', 'a'.repeat(65537), 'too-large'], ['utf8-oversize', '😀'.repeat(16385), 'too-large'], ['unpaired', '\ud800', 'invalid-input']]) rows.push({ id, message: text, tag: sign(text), expected });
  for (const route of ['/missing', '/short', '/long']) rows.push({ id: `key${route}`, route, message, tag, expected: 'invalid-key' });
  return rows;
}
async function probe(url, rows, request = fetch) {
  const results = [];
  for (const row of rows) {
    const started = performance.now();
    const response = await request(new URL(row.route || '/', url), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: bearer, 'x-request-proof': row.tag, 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ message: row.message }) });
    assert.equal(response.status, 200, `${row.id}: unexpected HTTP status`);
    // Never retain response content, messages, tags or keys in a receipt/error.
    const reader = response.body.getReader();
    let bytes = 0, chunks = [];
    try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; assert(bytes <= 1024, `${row.id}: oversized response`); chunks.push(Buffer.from(item.value)); } }
    finally { await reader.cancel().catch(() => {}); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error(`${row.id}: invalid response JSON`); }
    assert(body && Object.keys(body).sort().join(',') === 'authorizationPreserved,existingBearer,status', `${row.id}: unexpected response shape`);
    assert(body.status === row.expected && body.authorizationPreserved === true && body.existingBearer === true, `${row.id}: proof outcome or Bearer preservation failed`);
    results.push({ id: row.id, status: 'passed', outcome: row.expected, elapsedMs: Math.round(performance.now() - started) });
  }
  return results;
}
async function run(bundleDir, configFile, output) {
  assert(!fs.existsSync(output), 'Use a fresh receipt path');
  const bundle = load(bundleDir);
  const receipt = { version: 'pulse.mac03-hosted.v1', lane: 'hosted-fastly-native', status: 'blocked', bundleSha256: bundle.sha256, artifactSha256: bundle.wasm.sha256, cases: [] };
  const save = () => fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
  if (!configFile || !process.env.FASTLY_API_TOKEN || !process.env.MAC03_PROOF_KEY_BASE64) {
    receipt.reason = 'Scoped service configuration, FASTLY_API_TOKEN and MAC03_PROOF_KEY_BASE64 are required'; save(); throw Error(receipt.reason);
  }
  let key;
  try {
    const encoded = process.env.MAC03_PROOF_KEY_BASE64;
    key = Buffer.from(encoded, 'base64');
    assert(key.toString('base64') === encoded && key.length >= 32 && key.length <= 4096, 'Proof key must be canonical base64 containing 32..4096 bytes');
    const configBytes = fs.readFileSync(configFile), config = JSON.parse(configBytes);
    assert.equal(config.version, 'pulse.mac03-hosted-config.v1');
    assert.match(config.serviceId, /^[a-zA-Z0-9]+$/);
    assert(Number.isSafeInteger(config.serviceVersion) && config.serviceVersion > 0);
    assert.match(config.filesHash, /^[a-f0-9]{128}$/);
    const url = new URL(config.url);
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use an HTTPS service root');
    assert.equal(hash(fs.readFileSync(config.cli.file)), config.cli.sha256, 'CLI pin mismatch');
    const version = execFileSync(config.cli.file, ['version'], { encoding: 'utf8', timeout: 10000 }).trim();
    assert.equal(version, config.cli.version);
    const archive = fs.readFileSync(config.package), archiveSha256 = hash(archive);
    const entries = [...readTarEntries(config.package)].filter(([file]) => /(^|\/)bin\/main\.wasm$/.test(file));
    assert.equal(entries.length, 1);
    assert.equal(hash(entries[0][1]), bundle.wasm.sha256, 'Package differs from installed-consumer Wasm');
    const digestOutput = execFileSync(config.cli.file, ['compute', 'hash-files', '--package', path.resolve(config.package), '--skip-build'], { encoding: 'utf8', timeout: 30000 });
    const digests = digestOutput.match(/\b[a-f0-9]{128}\b/g) || [];
    assert.equal(digests.length, 1); assert.equal(digests[0], config.filesHash);
    const inspect = async () => {
      const api = async suffix => { const r = await fetch(`https://api.fastly.com/service/${config.serviceId}/version/${config.serviceVersion}${suffix}`, { redirect: 'error', headers: { 'Fastly-Key': process.env.FASTLY_API_TOKEN }, signal: AbortSignal.timeout(15000) }); assert(r.ok, 'Fastly inspection failed: ' + r.status); return r.json(); };
      assert.equal((await api('')).active, true, 'Expected version is not active');
      assert((await api('/domain')).some(d => d.name === url.hostname), 'URL is not bound to this service');
      assert.equal((await api('/package')).metadata.files_hash, config.filesHash, 'Active package mismatch');
    };
    await inspect();
    receipt.status = 'running'; receipt.configSha256 = hash(configBytes);
    receipt.deployment = { serviceId: config.serviceId, serviceVersion: config.serviceVersion, filesHash: config.filesHash, archiveSha256, cli: { sha256: config.cli.sha256, version } }; save();
    receipt.cases = await probe(url, cases(key));
    await inspect();
    assert.equal(hash(fs.readFileSync(config.package)), archiveSha256);
    assert.equal(load(bundleDir).sha256, bundle.sha256);
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    // Third-party HTTP/CLI errors may contain arbitrary output. Deliberately
    // expose only a bounded classification; no raw exception or response body.
    receipt.reason = 'Hosted identity or request verification failed';
    throw Error(receipt.reason);
  } finally { key?.fill(0); save(); }
  return receipt;
}
if (require.main === module) {
  const [bundle, config, output] = process.argv.slice(2);
  assert(bundle && config && output, 'Usage: hosted.cjs BUNDLE CONFIG_OR_DASH FRESH_RECEIPT');
  run(bundle, config === '-' ? null : config, output).then(r => console.log(JSON.stringify({ status: r.status, cases: r.cases.length }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { run, probe, cases };
