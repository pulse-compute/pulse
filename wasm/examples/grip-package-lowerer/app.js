import { Router } from '@pulse-compute/runtime';
import { grip } from '@pulse-compute/grip/pulsewasm';

const router = new Router();

router.get('/events/demo', holdDemoEvents);
router.post('/events/demo', publishDemoEvent);

export default router;

export function holdDemoEvents(ctx) {
  void ctx;

  grip.channel('events:demo', {
    fanout: true
  });

  return grip.hold('stream', {
    channels: ['events:demo'],
    timeoutMs: 30000
  });
}

export function publishDemoEvent(ctx) {
  void ctx;

  return grip.publish('events:demo', 'hello beta lifecycle', {
    event: 'demo.message',
    id: 'demo-1'
  });
}
