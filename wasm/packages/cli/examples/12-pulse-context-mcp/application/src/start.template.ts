import type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'
import type { StartInput, StartOutput } from './schemas.js'

// Generated plan values come from the exact corpus; cited configuration text is
// read from its single resource backing. No corpus module enters this graph.
export function computeStart(
  ctx: PulseComputationContext,
  input: PulseReadonly<StartInput>,
): StartOutput {
  let versionBytes = 0
  for (let i = 0; i < 193 && i < input.version.length; i++) {
    const c = input.version[i] ?? ''
    versionBytes += c < '\u0080' ? 1 : c < '\u0800' ? 2 : c >= '\udc00' && c <= '\udfff' ? 1 : 3
  }
  let goalBytes = 0
  for (let i = 0; i < 193 && i < input.goal.length; i++) {
    const c = input.goal[i] ?? ''
    goalBytes += c < '\u0080' ? 1 : c < '\u0800' ? 2 : c >= '\udc00' && c <= '\udfff' ? 1 : 3
  }
  let providerBytes = 0
  for (let i = 0; i < 193 && i < input.provider.length; i++) {
    const c = input.provider[i] ?? ''
    providerBytes += c < '\u0080' ? 1 : c < '\u0800' ? 2 : c >= '\udc00' && c <= '\udfff' ? 1 : 3
  }
  let targetBytes = 0
  for (let i = 0; i < 193 && i < input.target.length; i++) {
    const c = input.target[i] ?? ''
    targetBytes += c < '\u0080' ? 1 : c < '\u0800' ? 2 : c >= '\udc00' && c <= '\udfff' ? 1 : 3
  }
__START_BODY__
}
