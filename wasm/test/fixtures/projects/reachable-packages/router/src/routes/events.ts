import { grip } from '@pulse-compute/grip/pulsewasm'

export async function holdEvents(ctx) {
  await grip.channel('events:reachable', { fanout: true })
  return grip.hold('stream', {
    channels: ['events:extra'],
    timeoutMs: 30_000,
  })
}

export async function publishEvent(ctx) {
  return grip.publish('events:reachable', 'hello from reachable graph', {
    event: 'pulse.message',
    id: 'reachable-1',
  })
}
