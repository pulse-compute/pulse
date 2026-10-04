export default { cases: [
  { name: 'search', request: { method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'directory.search', params: { query: 'Pulse' } }) },
    config: { DIRECTORY_ORIGIN: 'https://directory.example.test' },
    fetches: { 'https://directory.example.test/search': { value: { resources: [{ id: 'pulse', title: 'Pulse', url: 'https://pulsecompute.io' }] } } },
    expect: { status: 200, json: { jsonrpc: '2.0', id: 1, result: { resources: [{ id: 'pulse', title: 'Pulse', url: 'https://pulsecompute.io' }] } } } },
  { name: 'invalid-input', request: { method: 'POST', path: '/', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'directory.retrieve', params: { id: 1 } }) },
    expect: { status: 200, json: { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'Invalid params' } } } },
] }
