export default {
  cases: [
    {
      name: 'health',
      request: { path: '/health' },
      expect: { status: 200, json: { ok: true } },
    },
    {
      name: 'hello',
      request: { path: '/hello' },
      expect: {
        status: 200,
        json: { message: 'hello from Pulse' },
      },
    },
    {
      name: 'missing',
      request: { path: '/missing' },
      expect: { status: 404, text: 'not found' },
    },
  ],
}
