export default { cases: [
  {
    name: 'http health remains separate',
    request: { method: 'GET', path: '/health' },
    expect: { status: 200, text: 'ok' },
  },
  {
    name: 'schema event emits an accepted frame',
    kind: 'event',
    event: {
      type: 'device.reading',
      schema: 'events.DeviceReading',
      payload: { deviceId: 'sensor-7', temperatureC: 21 },
    },
    expect: {
      status: 'completed',
      emitted: [{
        type: 'device.reading.accepted',
        schema: 'events.DeviceReadingAccepted',
        payload: { deviceId: 'sensor-7', accepted: true },
      }],
    },
  },
  {
    name: 'no-payload event emits a no-payload frame',
    kind: 'event',
    event: { type: 'system.tick', schema: null },
    expect: {
      status: 'completed',
      emitted: [{ type: 'system.heartbeat', schema: null }],
    },
  },
] }

