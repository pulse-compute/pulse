import type { TextDigestResult } from './digest.js';
export declare function normalizeTextDigestResult(value: unknown): TextDigestResult;
declare const provider: { rsaPrivateKeyBytes: typeof rsaPrivateKeyBytes; normalizeTextDigestResult: typeof normalizeTextDigestResult };
export default provider;

export declare function rsaPrivateKeyBytes(components: Readonly<Record<string, unknown>>): Promise<Uint8Array>;
