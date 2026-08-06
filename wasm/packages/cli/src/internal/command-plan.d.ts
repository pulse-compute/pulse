import type { NormalizedCommandRequest, MetaCommandRequest } from './command-request';
import type { ProjectContext } from './project-context';

export type CommandPlan = Readonly<Record<string, unknown> & { ok: true; command: string }>;
export declare function createCommandPlan(
  request: NormalizedCommandRequest | MetaCommandRequest | Readonly<Record<string, unknown>>,
  options?: Readonly<{ cwd?: string; version?: string; projectContext?: ProjectContext }>
): CommandPlan;
export declare function isCommandPlan(value: unknown): value is CommandPlan;
