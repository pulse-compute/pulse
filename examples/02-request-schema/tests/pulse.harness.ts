export default {
  cases: [
    {
      name: 'create-user',
      request: {
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', active: true }),
      },
      expect: {
        status: 201,
        json: {
          id: 7,
          name: 'Ada',
          active: true,
          sameReference: true,
        },
      },
    },
    {
      name: 'invalid-user',
      request: {
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 12, active: true }),
      },
      expect: {
        error: {
          name: 'SchemaDecodeError',
          code: 'PULSE_SCHEMA_DECODE',
        },
      },
    },
  ],
}
