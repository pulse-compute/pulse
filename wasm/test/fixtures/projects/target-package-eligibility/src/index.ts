import { assets } from '@pulse-compute/assets/pulsewasm'
import type { GripHold } from '@pulse-compute/grip/pulsewasm'

export default async function handler(ctx) {
  type _EvidenceOnly = GripHold
  return ctx.text('package eligibility')
}
