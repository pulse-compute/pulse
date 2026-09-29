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
}
export interface McpHttpHandler { fetch(request: Request): Promise<Response> }
export declare function createMcpHttpHandler(options?: McpHttpOptions): Readonly<McpHttpHandler>;
