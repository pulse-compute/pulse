export const cases = [
  {
    name: 'health',
    request: { method: 'GET', path: '/health' },
    expect: { status: 200, json: { ok: true } },
  },
]
