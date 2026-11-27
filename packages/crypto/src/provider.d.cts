import type { MacTextOptions, MacTextVerificationResult } from './mac-text.js';
export declare function normalizeMacTextOptions(value: unknown): MacTextOptions | null;
export declare function normalizeMacTextResult(value: unknown): MacTextVerificationResult;
import type { TextDigestResult } from './digest.js';
export declare function normalizeTextDigestResult(value: unknown): TextDigestResult;
declare const provider: { normalizeMacTextOptions: typeof normalizeMacTextOptions; normalizeMacTextResult: typeof normalizeMacTextResult; rsaPrivateKeyBytes: typeof rsaPrivateKeyBytes; normalizeTextDigestResult: typeof normalizeTextDigestResult };
export default provider;

export declare function rsaPrivateKeyBytes(components: Readonly<Record<string, unknown>>): Promise<Uint8Array>;
