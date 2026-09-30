import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// Only fixed acceptance operations are issued. The selected environment must
// authorize three bounded proposal writes over the complete A -> B -> A run.
export async function probe({ mcpUrl, helloUrl, readerToken, writerToken, loopback = false }, { signal }) {
  const urls = [new URL(mcpUrl), new URL(helloUrl)];
  for (const url of urls) {
    assert.equal(url.username + url.password + url.search + url.hash, '');
    assert.ok(url.protocol === 'https:' || (loopback && url.protocol === 'http:' && url.hostname === '127.0.0.1'));
  }
  const clients = [];
  const request = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  const connect = async token => {
    const client = new Client({ name: 'pulse-ops01', version: '0.0.0' }, {
      capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(urls[0], {
      requestInit: { headers: { authorization: 'Bearer ' + token } }, onInsufficientScope: 'throw',
      fetch: async (url, options) => {
        assert.equal(new URL(url instanceof Request ? url.url : url).href, urls[0].href, 'Unexpected credential destination');
        const response = await request(url, options);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('mcp-session-id'), null);
        return response;
      }
    }));
    return client;
  };
  try {
    const challenge = await request(mcpUrl, { method:'POST', headers:{'content-type':'application/json',accept:'application/json, text/event-stream'}, body:'{}' });
    assert.equal(challenge.status, 401); assert.match(challenge.headers.get('www-authenticate'), /resource_metadata=/); await challenge.body?.cancel();
    const reader = await connect(readerToken);
    assert.deepEqual(reader.getServerCapabilities(), { tools:{ listChanged:false } });
    assert.deepEqual((await reader.listTools()).tools.map(t=>t.name), ['directory.retrieve','directory.search']);
    const call = (client, name, args) => client.callTool({ name:'directory.' + name, arguments:args });
    await assert.rejects(call(reader, 'propose-update', { id:'pulse',title:'OPS01 denied',reason:'Read-only principal' }));
    assert.equal((await call(reader, 'retrieve', {id:1})).isError, true);
    const search = await call(reader, 'search', {query:'pulse'});
    assert.equal(search.isError, false); assert.ok(search.structuredContent.resources.some(r=>r.id==='pulse'));
    const before = await call(reader, 'retrieve', {id:'pulse'});
    assert.equal(before.isError, false); assert.equal(before.structuredContent.found, true);
    const writer = await connect(writerToken);
    assert.equal((await writer.listTools()).tools.length, 3);
    const proposal = await call(writer, 'propose-update', { id:'pulse',title:'OPS01 acceptance proposal',reason:'Isolated operational acceptance; do not approve automatically' });
    assert.equal(proposal.isError, false); assert.equal(proposal.structuredContent.accepted, true);
    assert.equal(typeof proposal.structuredContent.proposalId, 'string');
    assert.deepEqual((await call(reader, 'retrieve', {id:'pulse'})).structuredContent, before.structuredContent);
    const health = await request(new URL('/health', helloUrl)); assert.equal(health.status,200); assert.deepEqual(await health.json(),{ok:true});
    const hello = await request(new URL('/hello', helloUrl)); assert.equal(hello.status,200); assert.equal(typeof (await hello.json()).message,'string');
    const missing = await request(new URL('/missing', helloUrl)); assert.equal(missing.status,404); await missing.body?.cancel();
    return ['unauthenticated-challenge','filtered-discovery','read-grant-denial','invalid-input','search','retrieve','proposal-without-resource-edit','native-health-hello-not-found'];
  } finally { await Promise.all(clients.map(c=>c.close().catch(()=>{}))); }
}
