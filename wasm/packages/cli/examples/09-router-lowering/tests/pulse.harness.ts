export default {
  cases: [
    {
      name: 'mounted-health',
      request: { method: 'GET', path: '/api/health' },
      expect: {
        status: 200,
        json: { ok: true, handler: 'primary' },
      },
    },
    {
      name: 'middleware-short-circuit',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'x-pulse-deny': '1' },
      },
      expect: {
        status: 401,
        json: { error: 'denied by middleware' },
      },
    },
    {
      name: 'scoped-middleware-short-circuit',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'x-api-state': 'closed' },
      },
      expect: { status: 503, text: 'api closed' },
    },
    {
      name: 'route-fallthrough',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'x-health-handler': 'fallback' },
      },
      expect: {
        status: 200,
        json: { ok: true, handler: 'fallback' },
      },
    },
    {
      name: 'error-middleware',
      request: { method: 'GET', path: '/api/failure' },
      expect: { status: 418, json: { error: 'handled' } },
    },
    {
      name: 'parameter-and-fetch',
      request: { method: 'GET', path: '/api/users/7' },
      fetches: {
        'https://users.example.test/users/7': {
          value: { id: 7, name: 'Ada' },
        },
      },
      expect: {
        status: 200,
        json: {
          route: 'user',
          id: '7',
          user: { id: 7, name: 'Ada' },
        },
      },
    },
    {
      name: 'method-specific-post',
      request: { method: 'POST', path: '/api/users' },
      expect: {
        status: 201,
        json: { route: 'create', method: 'POST' },
      },
    },
    {
      name: 'trailing-wildcard',
      request: {
        method: 'GET',
        path: '/api/files/guides/start',
      },
      expect: {
        status: 200,
        text: '/api/files/guides/start',
      },
    },
    {
      name: 'default-not-found',
      request: { method: 'GET', path: '/missing' },
      expect: { status: 404, text: 'Not Found' },
    },
  ],
}
