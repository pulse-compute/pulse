export default {
  cases: [
    {
      name: 'json-rpc-pass-through',
      request: {
        method: 'POST',
        path: '/mcp',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      },
      fetches: {
        'POST https://mcp.example.test/rpc': {
          opaque: true,
          status: 200,
          headers: [['content-type', 'application/json']],
          chunks: ['{"jsonrpc":"2.0","result":{},"id":1}'],
        },
      },
      expect: {
        status: 200,
        bodyClass: 'opaque',
      },
    },
  ],
}
