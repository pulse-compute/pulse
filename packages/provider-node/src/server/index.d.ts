/** Host integration only. Pass an immutable trusted directory emitted by pulse build. */
export interface NodeLauncherOptions {
  target: 'native' | 'javascript';
  buildDir: string;
  /** Default 127.0.0.1. Set explicitly for container ingress. */
  host?: string;
  /** Default 8787; 0 requests an ephemeral port. */
  port?: number;
  /** Reserved GET/HEAD endpoint; default /_pulse/ready. */
  readinessPath?: string;
  /** One request budget across body admission, effects and response completion. 1–30000; default 10000. */
  maxDurationMs?: number;
  /** Drain grace period, 1–30000; default 10000. */
  shutdownTimeoutMs?: number;
  /** Header admission timeout, 1–30000; default 10000. */
  headersTimeoutMs?: number;
  /** Idle keep-alive timeout, 1–30000; default 5000. */
  keepAliveTimeoutMs?: number;
  /** Each 1–2097152; defaults 65536. */
  maxRequestBodyBytes?: number;
  maxFetchBodyBytes?: number;
  /** Each 1–65536; defaults 128, 128, 512 respectively. */
  maxEffects?: number;
  maxConcurrentRequests?: number;
  maxConnections?: number;
  /** Explicit outbound fetch authorization; default false. */
  networkFetch?: boolean;
  /** Strict structured JSON policy; default true. Development profile values are not loaded. */
  strict?: boolean;
  config?: Readonly<Record<string, string>>;
  secrets?: Readonly<Record<string, string>>;
  /** In-memory reference KV seed. Reset on restart; no durability promise. */
  kv?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export interface NodeLauncherStatus {
  readonly state: 'created' | 'starting' | 'ready' | 'draining' | 'stopped';
  readonly target: 'native' | 'javascript';
  readonly buildId: string;
  readonly activeRequests: number;
  readonly address: Readonly<{ host: string; port: number }> | null;
}
export interface NodeLauncherCloseResult {
  readonly forced: boolean;
  readonly abortedRequests: number;
}
export interface NodeLauncher {
  /** Resolves after validated host initialization and successful listen. Idempotent while ready/starting. */
  start(): Promise<NodeLauncherStatus>;
  /** Immediately withdraws readiness, then drains. Does not install process handlers or call process.exit. */
  close(): Promise<NodeLauncherCloseResult>;
  status(): NodeLauncherStatus;
}
export function createNodeLauncher(options: NodeLauncherOptions): NodeLauncher;
