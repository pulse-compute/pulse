import type { PulseContext } from '@pulse-compute/runtime';

function unsupported(operation: string): never {
  throw Object.assign(new Error(
    `@pulse-compute/grip/experimental.${operation} requires the Fastly Native terminal service; JavaScript execution is unsupported.`,
  ), { code: 'PULSE_HOST_EXTENSION_TARGET' });
}

/** Experimental terminal transfer. Return directly from a plain Fastly Native handler.
 * No application value resumes after transfer; JavaScript execution always throws.
 */
export function handoffFanout(_ctx: PulseContext, _backend: string): never {
  return unsupported('handoffFanout');
}

/** Experimental WebSocket passthrough; the host owns the connection after transfer. */
export function handoffWebSocket(_ctx: PulseContext, _backend: string): never {
  return unsupported('handoffWebSocket');
}
