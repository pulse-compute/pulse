export default {
  cases: [
    { name: 'PUT route', request: { method: 'PUT', path: '/api/v1/resources/example/visibility' }, expect: { status: 200, json: { ok: true } } },
    { name: 'PATCH route', request: { method: 'PATCH', path: '/api/v1/resources/example' }, expect: { status: 200, json: { ok: true } } },
    { name: 'DELETE route', request: { method: 'DELETE', path: '/api/v1/resources/example' }, expect: { status: 200, json: { ok: true } } },
  ],
}
