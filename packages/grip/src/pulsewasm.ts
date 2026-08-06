/**
 * PulseWasm lowerable facade for @pulse-compute/grip.
 *
 * This module is the public package-owned lowering facade. PulseWasm compilers may recognize these
 * symbols statically and lower them to the internal `pulse.grip` library
 * contract. They are not a JavaScript GRIP runtime.
 */

export type GripHoldMode = 'stream' | 'response';

export type GripHoldOptions = {
  readonly channels?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
  readonly headers?: HeadersInit | undefined;
};

export type GripChannelOptions = {
  readonly prefix?: string | undefined;
  readonly fanout?: boolean | undefined;
};

export type GripPublishOptions = {
  readonly event?: string | undefined;
  readonly id?: string | undefined;
};

import type { PulseEffect, PulseResult } from '@pulse-compute/runtime';

export type GripHold = PulseEffect<PulseResult> & {
  readonly kind: 'pulse.grip.hold';
  readonly mode: GripHoldMode;
  readonly options?: GripHoldOptions | undefined;
};

export type GripChannel = PulseEffect<void> & {
  readonly kind: 'pulse.grip.channel';
  readonly channel: string;
  readonly options?: GripChannelOptions | undefined;
};

export type GripPublish = PulseEffect<PulseResult> & {
  readonly kind: 'pulse.grip.publish';
  readonly channel: string;
  readonly message: string;
  readonly options?: GripPublishOptions | undefined;
};

export class PulseWasmGripLoweringError extends Error {
  constructor(symbol: string) {
    super(
      `${symbol} is a PulseWasm lowerable facade and cannot run directly in JavaScript. Select a supported compiler/provider target; no direct JavaScript GRIP runtime is exported by this package.`,
    );
    this.name = 'PulseWasmGripLoweringError';
  }
}

function lowerableOnly(symbol: 'grip.hold' | 'grip.channel' | 'grip.publish'): never {
  throw new PulseWasmGripLoweringError(symbol);
}

export function hold(mode: GripHoldMode, options?: GripHoldOptions): GripHold {
  void mode;
  void options;
  return lowerableOnly('grip.hold');
}

export function channel(channelName: string, options?: GripChannelOptions): GripChannel {
  void channelName;
  void options;
  return lowerableOnly('grip.channel');
}

export function publish(channelName: string, message: string, options?: GripPublishOptions): GripPublish {
  void channelName;
  void message;
  void options;
  return lowerableOnly('grip.publish');
}

export const grip = Object.freeze({
  hold,
  channel,
  publish,
});

export default grip;
