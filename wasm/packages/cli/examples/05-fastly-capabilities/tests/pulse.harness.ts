const config = { API_BASE: 'https://api.example.com' }
const secrets = {
  API_TOKEN: 'test-example-secret',
  GRIP_TOKEN: 'test-grip-secret',
}
const grip = {
  publishEndpoint: 'https://publisher.example.com/publish',
  authentication: {
    scheme: 'bearer',
    secretRef: 'GRIP_TOKEN',
  },
}

export default {
  cases: [
    {
      name: 'configured-fetch',
      request: { path: '/users/7' },
      config,
      secrets,
      fetches: {
        'https://api.example.com/users/7': {
          value: { id: 7, name: 'Ada' },
        },
      },
      expect: {
        status: 200,
        json: { user: { id: 7, name: 'Ada' } },
      },
    },
    {
      name: 'session-hit',
      request: { path: '/session' },
      kv: { sessions: { 'session:123': { userId: 123 } } },
      expect: {
        status: 200,
        json: { session: { userId: 123 } },
      },
    },
    {
      name: 'session-miss',
      request: { path: '/session' },
      kv: { sessions: {} },
      expect: {
        status: 404,
        json: { error: 'not_found' },
      },
    },
    {
      name: 'grip-broadcast',
      request: { method: 'POST', path: '/publish' },
      secrets,
      grip,
      fetches: {
        'POST https://publisher.example.com/publish': {
          status: 202,
          value: { accepted: true, messageId: 'message-1' },
        },
      },
      expect: {
        status: 202,
        json: { accepted: true },
      },
    },
  ],
}
