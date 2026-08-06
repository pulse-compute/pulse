const config = { MODE: 'edge' }
const secrets = {
  TOKEN: 'representative-user-token',
  GRIP_TOKEN: 'representative-grip-token',
}
const kv = {
  sessions: {
    'session:1': { id: 'session-1' },
  },
  public: {
    'app.js': 'console.log("pulse-fastly")',
  },
}
const fetches = {
  'POST https://api.example.test/user': {
    status: 200,
    headers: { 'content-type': 'application/json' },
    value: { id: 7, score: 98.5 },
  },
  'POST https://publisher.example.test/publish': {
    status: 202,
    headers: { 'content-type': 'application/json' },
    value: { accepted: true, messageId: 'message-1' },
  },
}
const grip = {
  publishEndpoint: 'https://publisher.example.test/publish',
  authentication: {
    scheme: 'bearer',
    secretRef: 'GRIP_TOKEN',
  },
}

export default {
  cases: [
    {
      name: 'representative-request',
      request: {
        method: 'POST',
        path: '/users/42',
        headers: [['content-type', 'application/json']],
        body: JSON.stringify({ name: 'Ada', active: true }),
      },
      config,
      secrets,
      kv,
      fetches,
      grip,
      expect: {
        status: 201,
        json: {
          id: '42',
          name: 'Ada',
          active: true,
          middleware: 'seen',
          mode: 'edge',
          sessionId: 'session-1',
          stored: true,
          upstreamId: 7,
          score: 98.5,
          acknowledged: true,
          authenticated: true,
        },
      },
    },
    {
      name: 'assets-pass-through',
      request: { method: 'GET', path: '/assets/app.js' },
      config,
      secrets,
      kv,
      fetches,
      expect: {
        status: 200,
        text: 'console.log("pulse-fastly")',
        headers: [['content-type', 'text/javascript; charset=utf-8']],
      },
    },
    {
      name: 'head-bodyless-ownership',
      request: { method: 'HEAD', path: '/assets/app.js' },
      config,
      secrets,
      kv,
      fetches,
      expect: {
        status: 200,
        text: '',
        headers: [['content-type', 'text/javascript; charset=utf-8']],
      },
    },
    {
      name: 'bodyless-status',
      request: { method: 'GET', path: '/empty' },
      config,
      secrets,
      kv,
      fetches,
      expect: {
        status: 204,
        text: '',
        headers: [['x-pulse-empty', 'yes']],
      },
    },
    {
      name: 'request-contained-redacted-error',
      request: { method: 'GET', path: '/error' },
      config,
      secrets,
      kv,
      fetches,
      expect: { status: 500, text: 'Internal Server Error' },
    },
    {
      name: 'schema-response',
      request: { method: 'GET', path: '/schema' },
      config,
      secrets,
      kv,
      fetches,
      expect: { status: 200, json: { value: 'encoded' } },
    },
  ],
}
