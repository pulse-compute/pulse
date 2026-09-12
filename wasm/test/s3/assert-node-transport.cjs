'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { originRequest } = require('../../../packages/provider-node/src/runtime/s3-reader.js');
const { metadataFromHeaders } = require('../../../packages/s3/src/provider.js');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-s3-tls-'));
  let server;
  const previousCa = https.globalAgent.options.ca;
  try {
    const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
    const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
    assert.equal(generated.status, 0, 'Generate an ephemeral local test CA with OpenSSL');
    https.globalAgent.options.ca = fs.readFileSync(cert);
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
      assert.equal(req.headers['accept-encoding'], 'identity');
      if (req.url === '/pending') return;
      if (req.url === '/redirect') { res.writeHead(302, { location: '/bytes' }); res.end(); return; }
      res.setHeader('etag', Buffer.from('"é"', 'utf8').toString('latin1'));
      if (req.url === '/duplicate') res.setHeader('etag', ['"a"', '"b"']);
      res.setHeader('content-length', '4');
      res.end(Buffer.from('efbbbf61', 'hex'));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `https://127.0.0.1:${server.address().port}`;
    const read = (route, method = 'GET', signal = new AbortController().signal) => originRequest({ url: endpoint + route, method, headers: { 'accept-encoding': 'identity' } }, signal);
    const response = await read('/bytes');
    assert.equal(metadataFromHeaders(response.headers, false).etag, '"é"');
    const chunks = []; for await (const chunk of response.body) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString('hex'), 'efbbbf61'); response.close();
    const head = await read('/bytes', 'HEAD'); assert.equal(metadataFromHeaders(head.headers, true).byteLength, 4); head.close();
    const duplicate = await read('/duplicate'); assert.equal(metadataFromHeaders(duplicate.headers, false), null); duplicate.close();
    const redirect = await read('/redirect'); assert.equal(redirect.status, 302); redirect.close();
    const controller = new AbortController(); const pending = read('/pending', 'GET', controller.signal); controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    console.log('ok - Node TLS transport preserves header/body bytes and duplicates, exposes redirects and aborts');
  } finally {
    https.globalAgent.options.ca = previousCa;
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
