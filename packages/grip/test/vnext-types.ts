import { grip } from '../src/pulsewasm.js'
import type { PulseResult } from '@pulse-compute/runtime'

async function proof(): Promise<PulseResult> {
  await grip.channel('events')
  return grip.hold('stream')
}

async function publishProof(): Promise<PulseResult> {
  return grip.publish('events', 'hello')
}

void proof
void publishProof
