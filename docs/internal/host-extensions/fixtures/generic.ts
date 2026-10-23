import { grip } from '@pulse-compute/grip'
export default async function handler(ctx) {
  return grip.handoff({ channels: ['updates'] })
}
