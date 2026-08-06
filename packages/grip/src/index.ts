import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';
import packageRuntime from '@pulse-compute/runtime/package';

export type GripRequestLike = Request | {
  readonly method?: string;
  readonly headers?: Headers | Readonly<Record<string, string | undefined>> | readonly (readonly [string, string])[];
  header?(name: string): string | undefined;
};

export type GripSubscribeMode = 'stream' | 'response';

export interface GripSubscriptionOptions {
  readonly channel?: string;
  readonly channels?: readonly string[];
  readonly mode?: GripSubscribeMode;
  readonly timeoutMs?: number;
}

export interface GripHandoffOptions extends GripSubscriptionOptions {
  readonly status?: number;
  readonly headers?: HeadersInit;
  readonly body?: BodyInit | null;
}

export interface GripBroadcastMessage {
  readonly channel: string;
  readonly data: unknown;
  readonly event?: string;
  readonly id?: string;
}

export interface GripBroadcastAck {
  readonly accepted: boolean;
  readonly status?: number;
  readonly messageId?: string;
}

const gripRuntime = packageRuntime.createPackageRuntime({
  package: '@pulse-compute/grip',
  contractId: 'pulse.grip',
  providerKind: 'grip',
  operations: {
    broadcast: {
      kind: 'grip.broadcast',
      capability: 'grip.broadcast',
      result: 'ack',
    },
  },
} as const);

function headerValue(request: GripRequestLike, name: string): string | undefined {
  if ('header' in request && typeof request.header === 'function') return request.header(name);
  const headers = request.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const values = headers
      .filter(([key]) => String(key).toLowerCase() === name.toLowerCase())
      .map(([, value]) => String(value));
    return values.length > 0 ? values.join(', ') : undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && value !== undefined) return String(value);
  }
  return undefined;
}

function normalizeChannels(options: GripSubscriptionOptions): readonly string[] {
  const input = options.channels ?? (options.channel === undefined ? [] : [options.channel]);
  if (!Array.isArray(input) || input.length === 0) throw new TypeError('GRIP subscription requires at least one channel.');
  const channels = input.map((value) => {
    const channelName = String(value).trim();
    if (!channelName) throw new TypeError('GRIP channel names must be non-empty strings.');
    if (/[,\r\n]/.test(channelName)) throw new TypeError('GRIP channel names may not contain commas or line breaks.');
    return channelName;
  });
  return Object.freeze(channels);
}

function applySubscriptionHeaders(headers: Headers, options: GripSubscriptionOptions): Headers {
  const mode = options.mode ?? 'stream';
  if (mode !== 'stream' && mode !== 'response') throw new TypeError('GRIP subscription mode must be stream or response.');
  headers.set('Grip-Hold', mode);
  headers.delete('Grip-Channel');
  headers.delete('Grip-Timeout');
  for (const channelName of normalizeChannels(options)) headers.append('Grip-Channel', channelName);
  if (options.timeoutMs !== undefined) {
    const timeoutMs = Number(options.timeoutMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new TypeError('GRIP timeoutMs must be a non-negative safe integer.');
    headers.set('Grip-Timeout', String(timeoutMs));
  }
  return headers;
}

/** Pure classification. Pulse never creates or owns a WebSocket object. */
export function isWebSocket(request: GripRequestLike): boolean {
  const contentType = (headerValue(request, 'content-type') || '').toLowerCase();
  const accept = (headerValue(request, 'accept') || '').toLowerCase();
  const upgrade = (headerValue(request, 'upgrade') || '').toLowerCase();
  const connection = (headerValue(request, 'connection') || '').toLowerCase();
  return contentType.includes('application/websocket-events')
    || accept.includes('application/websocket-events')
    || (upgrade === 'websocket' && connection.split(',').some((value) => value.trim() === 'upgrade'));
}

/** Pure response decoration. The external GRIP gateway owns the held connection. */
export function subscribe(response: Response, options: GripSubscriptionOptions): Response {
  if (!(response instanceof Response)) throw new TypeError('grip.subscribe requires a Web Response.');
  const headers = applySubscriptionHeaders(new Headers(response.headers), options);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Pure HTTP handoff framing for websocket-over-HTTP requests. */
export function handoff(options: GripHandoffOptions): Response {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type')) headers.set('Content-Type', 'application/websocket-events');
  applySubscriptionHeaders(headers, options);
  return new Response(options.body ?? null, {
    status: options.status ?? 200,
    headers,
  });
}

/** The only request-bound I/O operation in the bounded GRIP API. */
export function broadcast(
  ctx: PulseContext,
  message: GripBroadcastMessage,
): PulseParallelEffect<GripBroadcastAck> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('grip.broadcast requires a structured message.');
  }
  const channelName = String(message.channel || '').trim();
  if (!channelName || /[,\r\n]/.test(channelName)) {
    throw new TypeError('grip.broadcast channel must be non-empty and may not contain commas or line breaks.');
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'data') || message.data === undefined) {
    throw new TypeError('grip.broadcast requires a JSON-compatible data value.');
  }
  return gripRuntime.effect(ctx, 'broadcast', {
    channel: channelName,
    data: message.data,
    ...(message.event === undefined ? {} : { event: String(message.event) }),
    ...(message.id === undefined ? {} : { id: String(message.id) }),
  }, (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Readonly<Record<string, unknown>>;
      const status = record.status === undefined ? undefined : Number(record.status);
      const messageId = record.messageId === undefined ? undefined : String(record.messageId);
      return Object.freeze({
        accepted: record.accepted !== false,
        ...(Number.isSafeInteger(status) ? { status } : {}),
        ...(messageId === undefined ? {} : { messageId }),
      });
    }
    return Object.freeze({ accepted: value !== false });
  });
}

export const grip = Object.freeze({
  isWebSocket,
  subscribe,
  handoff,
  broadcast,
});

export default grip;
