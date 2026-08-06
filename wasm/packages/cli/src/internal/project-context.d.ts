import type { NormalizedCommandRequest } from './command-request';

export interface ProjectContextWorkspace {
  readonly version: string;
  readonly kind: 'conventional';
  readonly root: string;
  readonly configFile: string;
  readonly source: string;
  readonly boundary: string;
  readonly configInsideWorkspace: boolean;
}

export interface ProjectContextProfile {
  readonly name: string;
  readonly source: string;
  readonly host: string;
  readonly target: 'native' | 'javascript';
  readonly reporting: 'off' | 'error' | 'warn' | 'info' | 'debug';
  readonly reportingLevel: 0 | 1 | 2 | 3 | 4;
}

export interface ProjectContextPlan {
  readonly version: string;
  readonly projectVersion: string;
  readonly pulse: Readonly<{
    entry: string;
    schema: string | null;
    tests: string | null;
    defaultProfile: string;
    strict: boolean;
    reporting: 'off' | 'error' | 'warn' | 'info' | 'debug';
  }>;
  readonly profile: ProjectContextProfile;
  readonly bindings: Readonly<{ config: readonly string[]; secret: readonly string[] }>;
  readonly fragmentKeys: readonly string[];
}

export interface ProjectContext {
  readonly cwd: string;
  readonly workspace: ProjectContextWorkspace;
  readonly configFile: string;
  readonly selectedProfile: ProjectContextProfile;
  readonly selectionSource: string;
  readonly projectPlan: ProjectContextPlan;
  readonly projectHash: string;
  readonly planHash: string;
  readonly entryFile: string;
  readonly schemaFile: string | null;
  readonly testsFile: string | null;
  readonly target: 'native' | 'javascript';
  readonly reporting: 'off' | 'error' | 'warn' | 'info' | 'debug';
  readonly reportingLevel: 0 | 1 | 2 | 3 | 4;
  readonly provider: string;
  readonly outDir: string;
  readonly invocationOverrides: Readonly<Partial<Record<'directory' | 'profile' | 'outDir' | 'host' | 'port' | 'watch', unknown>>>;
}

export declare const INVOCATION_OVERRIDE_KEYS: readonly ['directory', 'profile', 'outDir', 'host', 'port', 'watch'];
export declare function commandRequiresProjectContext(request: NormalizedCommandRequest | readonly string[] | Readonly<Record<string, unknown>>): boolean;
export declare function createProjectContext(request: NormalizedCommandRequest | Readonly<Record<string, unknown>>, project: Readonly<Record<string, unknown>>, options?: Readonly<{ cwd?: string }>): ProjectContext;
export declare function resolveProjectContext(request: NormalizedCommandRequest | readonly string[] | Readonly<Record<string, unknown>>, options?: Readonly<{ cwd?: string; environment?: NodeJS.ProcessEnv; env?: NodeJS.ProcessEnv }>): ProjectContext;
export declare function isProjectContext(value: unknown): value is ProjectContext;
export declare function resolvedProjectForContext(context: ProjectContext): Readonly<Record<string, unknown>>;
export declare function requestForContext(context: ProjectContext): NormalizedCommandRequest;
export declare function projectDocumentForContext(context: ProjectContext): Readonly<Record<string, unknown>>;
export declare function projectContextDocument(context: ProjectContext): ProjectContext;
