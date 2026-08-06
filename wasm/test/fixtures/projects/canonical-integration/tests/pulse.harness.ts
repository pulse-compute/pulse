export default {
  cases: [
    {
      name: 'state-through-effect-and-mount',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: [['x-request-id', 'request-1']],
      },
      config: { APP_VERSION: 'canonical' },
      expect: {
        status: 200,
        json: { ok: true, requestId: 'request-1', version: 'canonical' },
      },
    },
    {
      name: 'state-isolated-per-request',
      request: { method: 'GET', path: '/api/health' },
      config: { APP_VERSION: 'canonical' },
      expect: {
        status: 200,
        json: { ok: true, requestId: 'missing', version: 'canonical' },
      },
    },
  ],
}
