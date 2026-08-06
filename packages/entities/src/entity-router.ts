import type { PulseContext } from '@pulse-compute/runtime';
import entitiesRuntime from '@pulse-compute/wasm-contracts/entities/runtime';
import entitiesJsonRpc from '@pulse-compute/wasm-contracts/entities/json-rpc';
import {
  EnvelopeScanError,
  scanJsonRpcEnvelope,
  type JsonRpcEnvelopeSelection,
} from './internal/bounded-json-rpc.js';
import { bindEntitySchemaCodecBridge } from './internal/schema-codec-bridge.js';
import type {
  EntityAdapter,
  EntityDeclaration,
  EntityHandler,
  EntityRouterOptions,
} from './types.js';

interface RouterRegistration {
  readonly discriminator: string;
  readonly declaration: EntityDeclaration;
  readonly handler: Function;
}

interface RouterState {
  readonly adapter: EntityAdapter;
  readonly registrations: Map<string, RouterRegistration>;
  readonly activeContexts: WeakSet<object>;
}

const routerStates = new WeakMap<EntityRouter, RouterState>();

function routerError(code: string, message: string): Error & { readonly code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = 'EntitiesRuntimeError';
  error.code = code;
  return error;
}

function normalizeRouterOptions(options: EntityRouterOptions): EntityAdapter {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw entitiesRuntime.entitiesContractError(
      entitiesRuntime.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED,
      'EntityRouter requires a static options object.',
    );
  }
  const unknown = Object.keys(options).filter((key) => key !== 'adapter').sort();
  if (unknown.length > 0) {
    throw entitiesRuntime.entitiesContractError(
      entitiesRuntime.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID,
      `EntityRouter options contain unsupported fields: ${unknown.join(', ')}.`,
    );
  }
  return entitiesRuntime.normalizeAdapter(options.adapter) as EntityAdapter;
}

type EntityFailureKind =
  | 'invalid-envelope'
  | 'unknown-entity'
  | 'invalid-input'
  | 'execution-failed'
  | 'invalid-output'
  | 'input-too-large'
  | 'output-too-large'
  | 'adapter-failed';

const JSON_RESPONSE_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8' });
const PARSE_ERROR_CODES = new Set(['PULSE_ENTITIES_JSON_MALFORMED']);
const INPUT_TOO_LARGE_CODES = new Set([
  'PULSE_BODY_TOO_LARGE',
  'PULSE_ENTITIES_ENVELOPE_TOO_LARGE',
  'PULSE_ENTITIES_PAYLOAD_TOO_LARGE',
]);

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function observeFailure(ctx: PulseContext, kind: EntityFailureKind, notification: boolean): void {
  try {
    ctx.log.error(`Entity ${notification ? 'notification' : 'request'} failed (${kind}).`);
  } catch {
    // Provider-owned observability is best effort and never changes protocol completion.
  }
}

function acknowledgement(): Response {
  return new Response(null, { status: 204 });
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: JSON_RESPONSE_HEADERS });
}

function completeFailure(
  ctx: PulseContext,
  limits: EntityAdapter['limits'],
  selection: JsonRpcEnvelopeSelection | null,
  kind: EntityFailureKind,
  parseError = false,
): Response {
  const notification = selection !== null && !selection.idPresent;
  observeFailure(ctx, kind, notification);
  if (notification) return acknowledgement();
  const mapping = parseError
    ? Object.freeze({ code: entitiesJsonRpc.ENTITIES_JSON_RPC_ERROR_CODES.parse, message: 'Parse error' })
    : entitiesJsonRpc.mapEntitiesFailureToJsonRpc(entitiesRuntime.normalizeEntityFailure({
      kind,
      message: 'Entity operation failed.',
    }, limits));
  const id = selection?.idPresent ? selection.idRaw! : 'null';
  return jsonResponse(`{"jsonrpc":"2.0","error":{"code":${mapping.code},"message":${JSON.stringify(mapping.message)}},"id":${id}}`);
}

function isNamedParams(selection: JsonRpcEnvelopeSelection): boolean {
  return !selection.paramsPresent || selection.paramsRaw?.startsWith('{') === true;
}

function isEmptyObject(raw: string | undefined): boolean {
  return raw?.startsWith('{') === true
    && raw.endsWith('}')
    && raw.slice(1, -1).trim() === '';
}

function catalogEligibility(): Readonly<Record<string, true>> {
  return Object.freeze({
    'fastly-javascript': true,
    'fastly-native': true,
    'node-javascript': true,
    'node-native': true,
  });
}

export class EntityRouter {
  constructor(options: EntityRouterOptions) {
    const adapter = normalizeRouterOptions(options);
    routerStates.set(this, { adapter, registrations: new Map(), activeContexts: new WeakSet() });
  }

  on<Input, Output>(
    discriminator: string,
    declaration: EntityDeclaration,
    handler: EntityHandler<Input, Output>,
  ): this {
    const state = routerStates.get(this);
    if (!state) throw routerError('PULSE_ENTITIES_ROUTER_INVALID', 'EntityRouter state is unavailable.');
    const registration = entitiesRuntime.normalizeEntityRegistration({
      discriminator,
      declaration,
      handler,
    }, state.adapter.limits) as RouterRegistration;
    if (state.registrations.has(registration.discriminator)) {
      throw entitiesRuntime.entitiesContractError(
        entitiesRuntime.ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_DUPLICATE,
        `Entity discriminator ${JSON.stringify(registration.discriminator)} is already registered.`,
        { discriminator: registration.discriminator },
      );
    }
    if (state.registrations.size + 1 > state.adapter.limits.maxEntities) {
      throw entitiesRuntime.entitiesContractError(
        entitiesRuntime.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED,
        'Entity registry exceeds its entity limit.',
      );
    }
    const next = [...state.registrations.values(), registration]
      .sort((left, right) => entitiesRuntime.compareText(left.discriminator, right.discriminator));
    const metadataBytes = next.reduce((sum, entry) => sum + (
      entry.declaration.metadata
        ? entitiesRuntime.utf8ByteLength(JSON.stringify(entry.declaration.metadata))
        : 0
    ), 0);
    if (metadataBytes > state.adapter.limits.maxMetadataBytesPerRouter) {
      throw entitiesRuntime.entitiesContractError(
        entitiesRuntime.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED,
        'Entity router metadata exceeds its aggregate byte limit.',
      );
    }
    state.registrations.clear();
    for (const entry of next) state.registrations.set(entry.discriminator, entry);
    return this;
  }

  async handle(ctx: PulseContext): Promise<Response> {
    const state = routerStates.get(this);
    if (!state) throw routerError('PULSE_ENTITIES_ROUTER_INVALID', 'EntityRouter state is unavailable.');
    const contextObject = ctx && (typeof ctx === 'object' || typeof ctx === 'function') ? ctx as object : null;
    if (contextObject && state.activeContexts.has(contextObject)) {
      return completeFailure(ctx, state.adapter.limits, null, 'adapter-failed');
    }
    if (contextObject) state.activeContexts.add(contextObject);

    try {
      let envelopeText: string;
      try {
        envelopeText = await ctx.req.text();
      } catch (error) {
        return completeFailure(
          ctx,
          state.adapter.limits,
          null,
          INPUT_TOO_LARGE_CODES.has(errorCode(error) || '') ? 'input-too-large' : 'adapter-failed',
        );
      }

      let selection: JsonRpcEnvelopeSelection;
      try {
        selection = scanJsonRpcEnvelope(envelopeText, {
          maxEnvelopeBytes: state.adapter.limits.maxEnvelopeBytes,
          maxPayloadBytes: state.adapter.limits.maxPayloadBytes,
          maxMethodBytes: state.adapter.limits.maxMethodBytes,
          maxDepth: state.adapter.limits.maxJsonDepth,
        });
      } catch (error) {
        const code = errorCode(error) || '';
        const parseError = error instanceof EnvelopeScanError && PARSE_ERROR_CODES.has(code);
        return completeFailure(
          ctx,
          state.adapter.limits,
          null,
          INPUT_TOO_LARGE_CODES.has(code) ? 'input-too-large' : 'invalid-envelope',
          parseError,
        );
      }

      if (!isNamedParams(selection)) {
        return completeFailure(ctx, state.adapter.limits, selection, 'invalid-input');
      }

      const registration = state.registrations.get(selection.method);
      if (!registration) {
        return completeFailure(ctx, state.adapter.limits, selection, 'unknown-entity');
      }

      if (registration.declaration.input === null) {
        const acceptableEmpty = state.adapter.options.acceptEmptyObjectForNoInput
          && isEmptyObject(selection.paramsRaw);
        if (selection.paramsPresent && !acceptableEmpty) {
          return completeFailure(ctx, state.adapter.limits, selection, 'invalid-input');
        }
      } else if (!selection.paramsPresent) {
        return completeFailure(ctx, state.adapter.limits, selection, 'invalid-input');
      }

      let bridge: ReturnType<typeof bindEntitySchemaCodecBridge>;
      try {
        bridge = bindEntitySchemaCodecBridge(ctx, registration.declaration);
      } catch {
        return completeFailure(ctx, state.adapter.limits, selection, 'adapter-failed');
      }

      let input: unknown;
      if (registration.declaration.input !== null) {
        try {
          input = bridge.decodeEmbeddedJson(
            registration.declaration.input,
            selection.paramsRaw!,
          );
        } catch {
          return completeFailure(ctx, state.adapter.limits, selection, 'invalid-input');
        }
      }

      let output: unknown;
      try {
        output = await registration.handler(ctx, input);
      } catch {
        return completeFailure(ctx, state.adapter.limits, selection, 'execution-failed');
      }

      let encodedOutput = 'null';
      if (registration.declaration.output === null) {
        if (output !== undefined) {
          return completeFailure(ctx, state.adapter.limits, selection, 'invalid-output');
        }
      } else {
        try {
          encodedOutput = bridge.encodeEmbeddedJson(registration.declaration.output, output);
        } catch {
          return completeFailure(ctx, state.adapter.limits, selection, 'invalid-output');
        }
      }
      if (entitiesRuntime.utf8ByteLength(encodedOutput) > state.adapter.limits.maxOutputBytes) {
        return completeFailure(ctx, state.adapter.limits, selection, 'output-too-large');
      }
      if (!selection.idPresent) return acknowledgement();
      return jsonResponse(`{"jsonrpc":"2.0","result":${encodedOutput},"id":${selection.idRaw}}`);
    } finally {
      if (contextObject) state.activeContexts.delete(contextObject);
    }
  }
}

export function snapshotEntityRouterCatalog(
  router: EntityRouter,
  routerId: string,
): Readonly<Record<string, unknown>> {
  const state = routerStates.get(router);
  if (!state) throw routerError('PULSE_ENTITIES_ROUTER_INVALID', 'EntityRouter state is unavailable.');
  if (typeof routerId !== 'string' || routerId.length === 0) {
    throw new TypeError('Entity router catalog identity requires its static compiler router ID.');
  }
  const entities = Object.freeze([...state.registrations.values()].map((registration) => Object.freeze({
    name: registration.discriminator,
    inputSchema: registration.declaration.input,
    outputSchema: registration.declaration.output,
    ...(registration.declaration.metadata === undefined ? {} : { metadata: registration.declaration.metadata }),
    eligibility: catalogEligibility(),
  })));
  return Object.freeze({
    version: 'pulse.entities-catalog.v1',
    contractId: 'pulse.entities',
    routers: Object.freeze([Object.freeze({
      id: routerId,
      adapter: state.adapter.id,
      binding: 'request',
      entities,
    })]),
  });
}
