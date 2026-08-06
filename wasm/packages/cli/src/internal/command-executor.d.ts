import type { NormalizedCommandRequest, MetaCommandRequest } from './command-request';
import type { ProjectContext } from './project-context';
import type { CommandPlan } from './command-plan';

export interface CommandExecutionResult {
  readonly status: number;
  readonly help?: true;
  readonly version?: string;
  readonly completion?: string;
  readonly bytes?: number;
  readonly plan?: CommandPlan;
  readonly result?: Readonly<Record<string, any>>;
}

export declare const EXECUTOR_IDS: readonly ['meta', 'init', 'artifact', 'compile', 'build', 'test', 'inspect', 'doctor', 'dev'];
export declare function executeCommandPlan(
  plan: CommandPlan,
  request: NormalizedCommandRequest | MetaCommandRequest,
  options?: Readonly<{
    projectContext?: ProjectContext;
    cliVersion?: string;
    environment?: NodeJS.ProcessEnv;
    operations?: Readonly<Record<string, (...args: any[]) => any>>;
    onEvent?: (event: Readonly<Record<string, any>>) => void;
    signalSource?: NodeJS.Process;
  }>
): Promise<CommandExecutionResult>;
export declare function inspectArtifact(file: string): Readonly<Record<string, unknown>>;
export declare function summarizeExecutionError(error: unknown): Readonly<Record<string, unknown>>;
