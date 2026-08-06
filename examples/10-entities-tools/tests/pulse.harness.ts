export default { cases: [
  {
    name: 'system-status',
    request: {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'system.status', id: 'status-doc' }),
    },
    expect: {
      status: 200,
      json: { jsonrpc: '2.0', result: null, id: 'status-doc' },
    },
  },
  {
    name: 'customer-lookup',
    request: {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'customer.lookup',
        params: { email: 'ada@example.test' },
        id: 'lookup-doc',
      }),
    },
    fetches: {
      'https://directory.example.test/customers/ada@example.test': { value: 'Ada Lovelace' },
    },
    expect: {
      status: 200,
      json: {
        jsonrpc: '2.0',
        result: { email: 'ada@example.test', displayName: 'Ada Lovelace' },
        id: 'lookup-doc',
      },
    },
  },
] }
