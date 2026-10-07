import type { ReportCapsule, ReportCompletion, ReportAttribution } from './model';
export const MANIFEST_VERSION: 'pulse.project-execution.v10';
export const MAX_ARTIFACT_BYTES: number;
export function classifyInput(input: string | Uint8Array):
  { kind: 'historical-capsule'; capsule: ReportCapsule } |
  { kind: 'build-manifest'; operation: 'compile' | 'native-build'; manifest: unknown };
export function admitCompletedBuild(manifest: unknown, completionBytes: Uint8Array, options: {
  files: ReadonlyMap<string, Uint8Array>; snapshot?: ReportCompletion['snapshot'];
  selection?: { profile: string; host: string; target: 'native' };
}): { readonly kind: 'completed-wasm'; readonly completion: ReportCompletion;
  readonly availableSidecars: readonly string[]; readonly missingOptionalSidecars: readonly string[]; readonly currentSnapshotMatched: boolean };
export function verifyHistoricalArtifacts(input: unknown, files?: ReadonlyMap<string, Uint8Array>): {
  readonly capsule: ReportCapsule; readonly verified: readonly string[]; readonly absent: readonly string[]; readonly currentProjectVerified: false;
};
export function validateAttribution(input: unknown): ReportAttribution;
