/** Private, unreleased MCP component. Not a Pulse guest authoring API. */
export declare const PROTOCOL_VERSION: '2026-07-28';
export interface McpLimits {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxDepth: number;
  deadlineMs: number;
}
export declare const DEFAULT_LIMITS: Readonly<McpLimits>;
export interface McpToolsOptions {
  /** Parsed entities-catalog.json; copied and projected at construction. */
  catalog: unknown;
  /** Parsed schema-json-registry.json from the same backend build. */
  schemas: unknown;
  routerId: string;
  target: 'node-javascript' | 'node-native' | 'fastly-javascript' | 'fastly-native';
  /** Fixed governed JSON-RPC URL: HTTPS or loopback HTTP. No redirects. */
  endpoint: string;
  /** Separately provisioned, endpoint-scoped backend service credential; never a client token. */
  backendBearerToken?: string;
}
export interface McpAuthorizationOptions {
  /** Exact resource URL, whose path matches this handler; also the required token audience. */
  resource: string;
  /** Exact expected introspection issuer; advertised in protected-resource metadata. */
  issuer: string;
  /** Fixed RFC 7662 endpoint on the configured issuer origin; redirects forbidden. */
  introspectionEndpoint: string;
  /** Confidential resource-server credentials for client_secret_basic introspection. */
  clientId: string;
  clientSecret: string;
  /** Non-empty baseline scopes required for every MCP request. */
  scopes: readonly string[];
  /** Default deny: explicit tool name to additional required scopes. Empty array grants baseline access. */
  operations: Readonly<Record<string, readonly string[]>>;
  /** Test-only HTTP allowance for literal loopback IPs; HTTPS required otherwise. */
  allowInsecureLoopback?: boolean;
}
export interface McpHttpOptions {
  path?: string;
  serverInfo?: { name: string; version: string };
  /** Exact origins; an empty list rejects every present Origin header. */
  allowedOrigins?: readonly string[];
  /** May only lower defaults. Response budget must exceed request budget by 512 bytes. */
  limits?: Partial<McpLimits>;
  /** Enables bounded tools/list and tools/call through governed HTTP only. */
  tools?: McpToolsOptions;
  /** Optional for local mode. Authenticated tools require backendBearerToken. */
  authorization?: McpAuthorizationOptions;
}
export interface McpHttpHandler { fetch(request: Request): Promise<Response> }
export declare function createMcpHttpHandler(options?: McpHttpOptions): Readonly<McpHttpHandler>;
