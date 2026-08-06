export default {
  cases: [
    {
      name: 'pass-through',
      request: { path: '/archive' },
      fetches: {
        'https://assets.example.com/archive.bin': {
          opaque: true,
          status: 206,
          headers: [
            ['content-type', 'application/octet-stream'],
            ['x-part', 'one'],
            ['x-part', 'two'],
          ],
          chunks: ['opaque-example'],
        },
      },
      expect: {
        status: 206,
        bodyClass: 'opaque',
        headers: { 'x-part': ['one', 'two'] },
      },
    },
  ],
}
