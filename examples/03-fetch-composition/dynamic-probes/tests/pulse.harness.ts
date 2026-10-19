export default {
  cases: [
    {
      name: 'empty',
      request: {
        method: 'POST',
        path: '/probe',
        headers: { 'content-type': 'application/json' },
        body: '{"endpoints":[]}',
      },
      expect: { status: 200, json: { results: [] } },
    },
    {
      name: 'dynamic',
      request: {
        method: 'POST',
        path: '/probe',
        headers: { 'content-type': 'application/json' },
        body: '{"endpoints":["https://one.example/probe/a","https://two.example/probe/b"]}',
      },
      fetches: {
        'https://one.example/probe/a': { value: { ok: true }, delayMs: 10 },
        'https://two.example/probe/b': { value: { ok: false }, delayMs: 1 },
      },
      expect: { status: 200, json: { results: [{ ok: true }, { ok: false }] } },
    },
    {
      name: 'invalid-result',
      request: {
        method: 'POST',
        path: '/probe',
        headers: { 'content-type': 'application/json' },
        body: '{"endpoints":["https://one.example/probe/a"]}',
      },
      fetches: {
        'https://one.example/probe/a': { value: { ok: 'invalid' } },
      },
      expect: { status: 422, text: 'invalid probe data' },
    },
  ],
}
