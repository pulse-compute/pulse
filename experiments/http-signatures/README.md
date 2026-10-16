# HTTP Message Signatures — RFC 9421 investigation package

> **Status: experimental, private, JavaScript reference only.** This is an
> interoperability/contract probe, **not** a released Pulse package or a Native
> lowerer. It does **not** establish all-algorithm/all-component RFC 9421
> conformance, a supported application authoring API, or Fastly Native support.

The goal is to exercise whether HTTP message component canonicalization can
remain a package-owned, host-neutral operation while cryptography, key authority,
HTTP transport and trusted time remain separate. The first slice implements an
explicit **HMAC-SHA256** RFC 9421 profile and verifies the **exact RFC Appendix
B.2.5** test vector.

```js
import { signMessage, verifyMessage } from './src/index.js';

const message = {
  method: 'POST',
  url: 'https://api.example.test/hooks',
  headers: { 'content-digest': 'sha-256=:...:' },
};
const components = ['@method', '@target-uri', 'content-digest'];
const params = { created: 1780000000, keyid: 'hook-key', alg: 'hmac-sha256' };
const wire = await signMessage(message, {
  label: 'sig1', components, params, key: secretBytes,
});
// Set wire.signatureInput and wire.signature as HTTP fields.
// `content-digest` MUST separately be calculated/checked against the body.

const valid = await verifyMessage(message, {
  ...wire, label: 'sig1', key: trustedSecretBytes,
  requiredKeyId: 'hook-key',
  requiredComponents: ['@method', '@target-uri', 'content-digest'],
  nowSeconds: trustedNowSeconds, maxAgeSeconds: 60,
});
```

This profile supports unparameterized ordinary ASCII HTTP fields (including
`content-digest` as an **opaque field value**), and the following derived
components: `@method`, `@target-uri`, `@authority`, `@scheme`, `@path`, `@query`,
`@request-target` (origin-form only), and `@status`. Signatures are encoded as
RFC 8941 dictionaries containing a parameterized Inner List and a Byte Sequence;
wire values can contain multiple labeled signatures, but the verifier selects
one explicitly. Supported metadata parameters are `created`, `expires`, `keyid`,
`alg`, `nonce`, `tag`. Signers must provide `created` and `keyid`; verifiers must
supply a trusted key, required components, expected keyid, current time, and an
age bound. No automatic key discovery, runtime secret lookup, clock capture,
nonce storage, content-digest computation, or permission grant exists here.

## Scope intentionally excluded

- RFC 8941 `;sf`, `;key`, `;bs`, trailer, and `;req` component parameters;
  `@query-param`, response/request cross-signing, `Accept-Signature`, and
  complete structured-field normalizations.
- RSA-PSS, RSA-v1.5, ECDSA, Ed25519 and any algorithm other than HMAC-SHA256.
- HTTP/1.1 proxy and CONNECT request-target forms, ambiguous multivalue
  `set-cookie`, non-ASCII field values, and permissive SF formatting variants.
- Message-body authenticity **unless** the application separately verifies
  an RFC 9530 `Content-Digest` and requires its coverage by the signature.
- Per-message replay protection (a verified `created` bound is not a nonce
  store), secret rotation, application authorization or safe trust in an
  untrusted client-provided `url`/headers.

The host must supply the **actual authoritative HTTP target URI and field
values**. Browser/URL normalization, transport proxies, joined multi-value
headers, and transformations can invalidate signatures. Do not use this as an
HTTP authorization solution without an application profile and independent
security review.

## Next Pulse-specific qualification

1. Define a first-party package contract and supported package ownership in
   the release catalog only after human scope approval. Nothing here changes
   the compiler's trusted lowerer discovery or host capabilities.
2. Use the existing Crypto HMAC/SHA-256 seam rather than implementing new crypto.
   Investigate the key-size and data envelope contract and whether package
   effects can receive authoritative raw HTTP component values across providers.
3. Implement Native package-owned lowering and test the **same RFC vectors** on
   Node/Fastly Native and JavaScript targets, with unsupported input failing
   during inspection instead of falling back to JavaScript.
4. Expand the covered-component / algorithm surface only after the RFC 8941
   parser and signature policy are independently qualified.

Run the standalone reference test with `node --test test/*.test.js`.

Standards: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421),
[RFC 8941](https://www.rfc-editor.org/rfc/rfc8941),
[RFC 9530](https://www.rfc-editor.org/rfc/rfc9530).
