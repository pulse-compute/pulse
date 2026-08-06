const fetches = {
  'https://users.example.test/users/123': {
    value: { id: 123, name: 'Ada' },
    delayMs: 15,
  },
  'https://stats.example.test/users/123': {
    value: { score: 42 },
    delayMs: 5,
  },
  'https://flags.example.test/users/123': {
    value: { enabled: true },
    delayMs: 1,
  },
}

const summary = {
  id: 123,
  name: 'Ada',
  score: 42,
  enabled: true,
}

export default {
  cases: [
    {
      name: 'single',
      request: { path: '/user' },
      fetches,
      expect: {
        status: 200,
        json: { found: true, user: { id: 123, name: 'Ada' } },
      },
    },
    {
      name: 'sequential',
      request: { path: '/user-summary' },
      fetches,
      expect: { status: 200, json: summary },
    },
    {
      name: 'parallel',
      request: { path: '/user-summary-parallel' },
      fetches,
      expect: { status: 200, json: summary },
    },
  ],
}
