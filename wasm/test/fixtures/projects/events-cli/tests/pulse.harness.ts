export default [
  {
    name: 'http health remains unchanged',
    request: { method: 'GET', path: '/health' },
    expect: { status: 200, text: 'ok' },
  },
  {
    name: 'event ingress records exact emitted frames',
    kind: 'event',
    event: {
      type: 'input.received',
      schema: 'events.Input',
      payload: { sequence: 7 },
    },
    expect: {
      status: 'completed',
      emitted: [
        {
          type: 'output.accepted',
          schema: 'events.Output',
          payload: { accepted: true, sequence: 7 },
        },
      ],
    },
  },
]
