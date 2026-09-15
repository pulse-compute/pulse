import {
  crypto,
  type CryptoVerificationResult,
  type HmacVerificationKey,
  type MacVerifyRequest,
  type SignatureVerifyRequest,
} from '../src/index.js';

const key: HmacVerificationKey = {
  type: 'hmac-key-bytes',
  bytes: new Uint8Array(32),
};

const request: MacVerifyRequest = {
  algorithm: 'HS256',
  key,
  data: new Uint8Array(),
  tag: new Uint8Array(32),
};

const result: Promise<CryptoVerificationResult> = crypto.mac.verify(request);

// @ts-expect-error Algorithm aliases are not part of the canonical contract.
crypto.mac.verify({ ...request, algorithm: 'hs256' });

// @ts-expect-error MAC input is bytes, never an ambient string.
crypto.mac.verify({ ...request, data: 'payload' });

// @ts-expect-error Authenticators are bytes, never an ambient string.
crypto.mac.verify({ ...request, tag: 'signature' });

// @ts-expect-error A future asymmetric descriptor cannot satisfy the HMAC key contract.
crypto.mac.verify({ ...request, key: { type: 'asymmetric-public', bytes: new Uint8Array() } });

void result;

const signatureRequest: SignatureVerifyRequest = {
  algorithm: 'ES256',
  key: {
    type: 'p256-public-key-bytes',
    bytes: new Uint8Array(64),
  },
  data: new Uint8Array(),
  signature: new Uint8Array(64),
};

const signatureResult: Promise<CryptoVerificationResult> =
  crypto.signature.verify(signatureRequest);

// @ts-expect-error DER or string signatures never cross the crypto boundary.
crypto.signature.verify({ ...signatureRequest, signature: 'DER' });

// @ts-expect-error HMAC keys cannot satisfy the asymmetric request contract.
crypto.signature.verify({ ...signatureRequest, key });

void signatureResult;

import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';
import { digestText, DIGEST_TEXT_MAX_BYTES, type TextDigestResult } from '../src/index.js';
declare const ctx: PulseContext;
const digest: PulseParallelEffect<TextDigestResult> = digestText(ctx, 'exact text');
const maximum: 2097152 = DIGEST_TEXT_MAX_BYTES;
const grouped = ctx.parallel({ digest: crypto.digestText(ctx, '') });
// @ts-expect-error Digest is text-only.
digestText(ctx, new Uint8Array());
// @ts-expect-error Digest always requires the current context.
digestText('exact text');
// @ts-expect-error Digest has no alternate algorithm or encoding options.
digestText(ctx, 'text', { encoding: 'base64' });
void [digest, maximum, grouped];
