import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpHttpOptions } from './index.js';
export declare function createMcpNodeHandler(options?: McpHttpOptions):
  (request: IncomingMessage, response: ServerResponse) => Promise<void>;
