'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSuite, matrix, message, assertWire } = require('./context-fastly-clients.cjs');
async function receiptContracts() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-client-receipts-'));
  try {
    const output = path.join(temporary, 'receipts');
    const suite = createSuite({ temporary, root: path.resolve(__dirname, '../../..'), env: {}, output,
      run: async () => { throw Error('fixture: required client is unavailable'); } });
    await suite.prepare();
    suite.finish('failed', 'dependency blocker');
    assert.equal(suite.report.rows.length, 4);
    for (const row of suite.report.rows) {
      assert.equal(row.status, 'blocked'); assert.match(row.error, /required client is unavailable/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(output, row.id + '.json'))).status, 'blocked');
    }
    assert.throws(() => suite.assertPassed());
    const interrupted = createSuite({ temporary, output: path.join(temporary, 'interrupted') });
    interrupted.finish('passed');
    assert.equal(interrupted.report.status, 'failed', 'Incomplete coverage cannot produce an aggregate pass');
    assert(interrupted.report.rows.every(row => row.status === 'blocked'));
    const cases = ['pulse.start', 'pulse.read', 'pulse.search', 'pulse.example', 'pulse.diagnostic'].map(tool => ({ tool, expected: {}, input: {} }));
    for (const row of matrix) {
      const methods = row.profile === '2026-07-28' ? ['server/discover', 'tools/list'] : ['initialize', 'tools/list'];
      const requests = [...methods.map(method => message(row.profile, method, method === 'initialize' ? { protocolVersion: row.profile } : {})),
        ...cases.map(c => message(row.profile, 'tools/call', { name: c.tool, arguments: c.input }))];
      const wire = requests.map(req => ({ httpMethod: 'POST', request: JSON.parse(req.body), requestHeaders: req.headers, status: 200,
        responseHeaders: { 'cache-control': 'no-store' }, response: { id: 1, result: { isError: false, structuredContent: {}, content: [{type: 'text', text: '{}'}], capabilities: { tools: { listChanged: false } } } } }));
      if (row.profile === '2025-06-18') wire.push({ httpMethod: 'POST', request: { method: 'notifications/initialized' }, status: 202, responseHeaders: { 'cache-control': 'no-store' } });
      const valid = { ...row, wire }; assertWire(valid, cases);
      for (const mutate of [
        r => r.wire.splice(2, 1),
        r => r.wire[2].response.result.structuredContent = { corrupt: true },
        r => r.wire[0].response.id = 'wrong-id',
        r => r.wire[0].response.result.capabilities.resources = {},
        r => r.wire[0].responseHeaders['mcp-session-id'] = 'unexpected',
        r => r.wire.push({ httpMethod: 'POST', request: { method: row.profile === '2026-07-28' ? 'initialize' : 'server/discover' }, responseHeaders: { 'cache-control': 'no-store' } }),
      ]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => assertWire(bad, cases)); }
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  console.log('ok - client receipts reject missing dependencies, incomplete tools, changed IDs, capabilities, sessions and protocol fallback');
}
module.exports = { receiptContracts };
