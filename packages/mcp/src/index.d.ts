/** Private, unreleased MCP-02 component. Not a Pulse guest authoring API. */
export declare const PROTOCOL_VERSION: '2026-07-28';
export interface McpLimits {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxDepth: number;
  deadlineMs: number;
}
export declare const DEFAULT_LIMITS: Readonly<McpLimits>;
export interface McpHttpOptions {
  path?: string;
  serverInfo?: { name: string; version: string };
  /** Exact origins; an empty list rejects every present Origin header. */
  allowedOrigins?: readonly string[];
  /** May only lower defaults. Response budget must exceed request budget by 512 bytes. */
  limits?: Partial<McpLimits>;
}
export interface McpHttpHandler { fetch(request: Request): Promise<Response> }
export declare function createMcpHttpHandler(options?: McpHttpOptions): Readonly<McpHttpHandler>;
