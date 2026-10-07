import type { ReportCapsule } from './model';
export interface CollectedReport {
  readonly kind: 'historical-capsule' | 'completed-wasm';
  readonly capsule: ReportCapsule;
  readonly currentSnapshotMatched: boolean;
  readonly missingOptionalSidecars: readonly string[];
}
export function collectArtifactReport(file: string): CollectedReport;
export function collectProjectReport(options?: {
  cwd?: string; directory?: string; profile?: string; outDir?: string;
  env?: Record<string, string | undefined>;
  optimization?: 'default' | 'experimental-native-size' | 'experimental-native-bounded-size';
}): CollectedReport;
