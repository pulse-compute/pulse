import { grip } from '@pulse-compute/grip/pulsewasm';

export function holdStream(ctx) {
  void ctx;
  return grip.hold('stream', { timeoutMs: 30000 });
}

export function subscribeUpdates(ctx) {
  void ctx;
  return grip.channel('updates', { previousId: '0' });
}

export function publishUpdate(ctx) {
  void ctx;
  return grip.publish('updates', 'hello from beta lifecycle', { format: 'text' });
}
