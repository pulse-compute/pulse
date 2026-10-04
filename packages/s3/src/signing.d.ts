/** Trusted first-party host integration, not application lowering authority. */
export interface SigV4Crypto {
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  hmacSha256(key: Uint8Array, bytes: Uint8Array): Promise<Uint8Array>;
}
export interface HttpSigningInput {
  method: string;
  url: URL | string;
  accessId: string;
  secret: string;
  token?: string | undefined;
  region?: string | undefined;
  service?: string | undefined;
  headers?: HeadersInit | undefined;
  now?: Date | undefined;
  payloadHash?: string | undefined;
}
export declare function encodeS3Key(key: string): string;
export declare function signHttpRequest(input: HttpSigningInput, crypto: SigV4Crypto): Promise<Request>;
export declare function createAuthorization(input: {
  method: string; uri: string; query: string; headers: Readonly<Record<string, string>>;
  date: string; region: string; service: string; accessId: string; secret: string; payloadHash: string;
}, crypto: SigV4Crypto): Promise<string>;
