export type PulseCliCommand = 'init' | 'doctor' | 'inspect' | 'test' | 'dev' | 'compile' | 'build';

export interface CommonNormalizedRequest {
  readonly kind: 'command';
  readonly command: PulseCliCommand;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly help?: boolean;
}

export type MetaCommandRequest =
  | Readonly<{ kind: 'meta'; invocation: 'help' }>
  | Readonly<{ kind: 'meta'; invocation: 'version' }>
  | Readonly<{ kind: 'meta'; invocation: 'completion'; shell: 'bash' | 'zsh' | 'fish' }>;

export type NormalizedCommandRequest = Readonly<CommonNormalizedRequest & {
  readonly directory?: string;
  readonly profile?: string;
  readonly target?: string;
  readonly name?: string;
  readonly force?: boolean;
  readonly strict?: boolean;
  readonly artifact?: string;
  readonly caseName?: string;
  readonly host?: string;
  readonly port?: number;
  readonly watch?: boolean;
  readonly once?: boolean;
  readonly outDir?: string;
  readonly clean?: boolean;
  readonly experimentalNativeSize?: boolean;
}>;

export declare function parseCommandRequest(argv: readonly string[]): NormalizedCommandRequest | MetaCommandRequest;
export declare function normalizeCommandRequest(value: readonly string[] | Readonly<Record<string, unknown>>): NormalizedCommandRequest | MetaCommandRequest;
