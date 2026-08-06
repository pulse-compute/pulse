import type { MetaCommandRequest, NormalizedCommandRequest } from './command-request';
import type { CommandPlan } from './command-plan';
import type { CommandExecutionResult } from './command-executor';

export interface WritableLike { write(value: string): unknown }
export interface CommandReporter {
  reportPlan(request: NormalizedCommandRequest, plan: CommandPlan): void;
  reportEvent(request: NormalizedCommandRequest, event: Readonly<Record<string, unknown>>): void;
  reportExecution(request: NormalizedCommandRequest | MetaCommandRequest, plan: CommandPlan, execution: CommandExecutionResult): CommandExecutionResult;
  reportDiagnostic(summary: Readonly<Record<string, unknown>>, context?: Readonly<{ request?: NormalizedCommandRequest | MetaCommandRequest; argv?: readonly string[]; json?: boolean }>): void;
}

export declare function createCommandReporter(options?: Readonly<{ stdout?: WritableLike; stderr?: WritableLike; cliVersion?: string; usageText?: string }>): CommandReporter;
export declare function writeJson(stream: WritableLike, value: unknown): void;
export declare function writeHumanResult(stream: WritableLike, command: string, result: any): void;
