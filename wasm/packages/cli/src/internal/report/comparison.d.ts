import type { ReportCapsule, ReportComparison } from './model';
/** Compare validated retained evidence only; does not build, execute or load files. */
export function compareCapsules(before: ReportCapsule, after: ReportCapsule): ReportComparison;
export function validateComparison(input: unknown): ReportComparison;
export function parseComparison(input: string | Uint8Array): ReportComparison;
export function serializeComparison(input: ReportComparison): string;
