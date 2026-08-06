import { AssetBucketSignError } from "./errors.js";

export type SecretValue = string | Promise<string> | (() => string | Promise<string>);

export type SigV4Credentials = {
  key: SecretValue;
  secret: SecretValue;
  token?: SecretValue | undefined;
};

export type SigV4SignOptions = {
  method: string;
  url: URL | string;
  region?: string | undefined;
  service?: string | undefined;
  credentials: SigV4Credentials;
  headers?: HeadersInit | undefined;
  now?: Date | undefined;
  payloadHash?: string | undefined;
};

const encoder = new TextEncoder();

async function resolveSecret(value: SecretValue | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  const resolved = typeof value === "function" ? value() : value;
  return await resolved;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).slice().buffer;
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode(value)));
  return hex(digest);
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(encoder.encode(value)));
  return new Uint8Array(signature);
}

function formatAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = iso;
  const dateStamp = amzDate.slice(0, 8);
  return { amzDate, dateStamp };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });
  pairs.sort(([aKey, aVal], [bKey, bVal]) => {
    if (aKey === bKey) return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return aKey < bKey ? -1 : 1;
  });
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function collectCanonicalHeaders(headers: Headers, host: string): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const collected = new Map<string, string[]>();

  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "authorization") return;
    const values = collected.get(name) ?? [];
    values.push(normalizeHeaderValue(value));
    collected.set(name, values);
  });

  collected.set("host", [host]);

  const names = [...collected.keys()].sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${(collected.get(name) ?? []).join(",")}`)
    .join("\n") + "\n";
  const signedHeaders = names.join(";");

  return { canonicalHeaders, signedHeaders };
}

export async function signSigV4(options: SigV4SignOptions): Promise<Request> {
  try {
    const url = typeof options.url === "string" ? new URL(options.url) : new URL(options.url.toString());
    const region = options.region ?? "us-east-1";
    const service = options.service ?? "s3";
    const method = options.method.toUpperCase();
    const now = options.now ?? new Date();
    const { amzDate, dateStamp } = formatAmzDate(now);
    const accessKey = await resolveSecret(options.credentials.key);
    const secretKey = await resolveSecret(options.credentials.secret);
    const token = await resolveSecret(options.credentials.token);

    if (!accessKey) throw new Error("Missing access key");
    if (!secretKey) throw new Error("Missing secret key");

    const payloadHash = options.payloadHash ?? "UNSIGNED-PAYLOAD";
    const headers = new Headers(options.headers);
    headers.set("x-amz-date", amzDate);
    headers.set("x-amz-content-sha256", payloadHash);
    if (token) headers.set("x-amz-security-token", token);

    const { canonicalHeaders, signedHeaders } = collectCanonicalHeaders(headers, url.host);
    const canonicalRequest = [
      method,
      url.pathname || "/",
      canonicalQuery(url),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join("\n");

    const kSecret = encoder.encode(`AWS4${secretKey}`);
    const kDate = await hmac(kSecret, dateStamp);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, service);
    const kSigning = await hmac(kService, "aws4_request");
    const signature = hex(await hmac(kSigning, stringToSign));

    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    );

    return new Request(url, { method, headers });
  } catch (cause) {
    throw new AssetBucketSignError("Failed to sign S3-compatible request", { cause });
  }
}

export function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
}
