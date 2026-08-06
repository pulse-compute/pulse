const baseHeaders = [
  ['x-area', 'api'],
  ['x-child', 'ready'],
]

export default {
  cases: [
    {
      name: 'primary-route-context',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/items/42?view=full',
        path: '/api/items/42',
        headers: [...baseHeaders, ['x-owner', 'primary'], ['x-request-id', 'request-7'], ['x-state-marker', 'first-request']],
      },
      expect: {
        status: 200,
        json: {
          handler: 'primary',
          id: '42',
          scope: 'api',
          requestId: 'request-7',
          stateMarker: 'first-request',
          method: 'GET',
          url: 'http://parity.example.test/api/items/42?view=full',
          path: '/api/items/42',
        },
      },
    },
    {
      name: 'route-fallthrough',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/items/7',
        path: '/api/items/7',
        headers: [...baseHeaders, ['x-request-id', 'request-8']],
      },
      expect: {
        status: 200,
        json: { handler: 'fallback', id: '7', scope: 'api', requestId: 'request-8', stateMarker: 'missing' },
      },
    },
    {
      name: 'scoped-middleware-short-circuit',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/items/7',
        path: '/api/items/7',
        headers: [['x-child', 'ready']],
      },
      expect: { status: 403, text: 'area denied' },
    },
    {
      name: 'mounted-middleware-short-circuit',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/items/7',
        path: '/api/items/7',
        headers: [['x-area', 'api']],
      },
      expect: { status: 409, text: 'child denied' },
    },
    {
      name: 'request-body-and-header-pairs',
      request: {
        method: 'POST',
        url: 'http://parity.example.test/api/echo/9',
        path: '/api/echo/9',
        headers: [
          ...baseHeaders,
          ['content-type', 'text/plain'],
          ['x-repeat', 'alpha'],
          ['x-repeat', 'beta'],
        ],
        body: 'hello',
      },
      expect: {
        status: 201,
        json: {
          id: '9',
          body: 'hello',
          firstRepeat: 'alpha',
          headers: [
            ['x-area', 'api'],
            ['x-child', 'ready'],
            ['content-type', 'text/plain'],
            ['x-repeat', 'alpha'],
            ['x-repeat', 'beta'],
          ],
        },
        headers: [
          ['set-cookie', ['a=1; Path=/', 'b=2; Path=/']],
          ['x-repeat', ['one', 'two']],
          ['content-type', 'application/json; charset=utf-8'],
        ],
      },
    },
    {
      name: 'head-body-suppression',
      request: {
        method: 'HEAD',
        url: 'http://parity.example.test/api/head',
        path: '/api/head',
        headers: baseHeaders,
      },
      expect: { status: 200, text: '', headers: [['x-head', 'yes']] },
    },
    {
      name: 'bodyless-status-suppression',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/empty',
        path: '/api/empty',
        headers: baseHeaders,
      },
      expect: { status: 204, text: '', headers: [['x-empty', 'yes']] },
    },
    {
      name: 'custom-response',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/custom',
        path: '/api/custom',
        headers: baseHeaders,
      },
      expect: {
        status: 202,
        text: 'custom',
        headers: [['x-custom', ['one', 'two']]],
      },
    },
    {
      name: 'handled-error-lane',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/handled-error',
        path: '/api/handled-error',
        headers: [...baseHeaders, ['x-request-id', 'error-request']],
      },
      expect: {
        status: 418,
        json: {
          handled: 'boom',
          scope: 'api',
          requestId: 'error-request',
          path: '/api/handled-error',
        },
      },
    },
    {
      name: 'error-lane-exhaustion',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/unhandled-error',
        path: '/api/unhandled-error',
        headers: baseHeaders,
      },
      expect: { status: 500, text: 'Internal Server Error' },
    },
    {
      name: 'normal-lane-exhaustion',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/missing',
        path: '/missing',
      },
      expect: { status: 404, text: 'Not Found' },
    },
    {
      name: 'request-state-isolation',
      request: {
        method: 'GET',
        url: 'http://parity.example.test/api/items/8',
        path: '/api/items/8',
        headers: baseHeaders,
      },
      expect: {
        status: 200,
        json: { handler: 'fallback', id: '8', scope: 'api', requestId: 'missing', stateMarker: 'missing' },
      },
    },
  ],
}
