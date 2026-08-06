const origin = '__PULSE_REALITY_ORIGIN__'

export default {
  cases: [
    {
      name: 'structured-local-conformance',
      request: {
        method: 'POST',
        path: '/structured',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', active: true }),
      },
      config: { API_BASE: origin },
      secrets: { API_TOKEN: 'local-reality-secret' },
      kv: { state: {} },
      fetches: {
        [`${origin}/origin/user`]: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          value: { id: 7, authSeen: true },
        },
      },
      expect: {
        status: 201,
        json: { id: 7, name: 'Ada', active: true, stored: 'Ada', authSeen: true },
      },
    },
    {
      name: 'grip-hold-local-conformance',
      request: { method: 'GET', path: '/grip/hold' },
      grip: { holdBody: 'held' },
      expect: { status: 200 },
    },
    {
      name: 'grip-publish-local-conformance',
      request: { method: 'POST', path: '/grip/publish' },
      expect: { status: 202 },
    },
  ],
}
