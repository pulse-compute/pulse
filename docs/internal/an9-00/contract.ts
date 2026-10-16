/**
 * Frozen AN9-00 handoff: proposed passive wire shape, not a shipped API.
 * AN9-01 adds the optional block to the existing report schema/validator.
 * Closed records: reject unknown fields at every level; never serialize ASTs,
 * expression text, binding values, provider configuration or dependency code.
 */
export type Fact<T> =
  | { state: 'available'; value: T; reason: null }
  | { state: 'unavailable' | 'not-applicable'; value: null; reason: string };
export interface Coverage {
  status: 'complete' | 'partial' | 'unavailable' | 'not-applicable';
  observed: number;
  expected: number | null;
  reason: string | null;
}
export interface Span {
  /** Project-relative path or canonical npm source identity; never absolute. */
  file: string;
  /** Hash of the authored file, not emitted text. */
  sha256: string;
  /** UTF-16 offsets [start,end); line and column are one-based UTF-16. */
  start: { offset: number; line: number; column: number };
  end: { offset: number; line: number; column: number };
}
export interface Evidence {
  basis: 'authored-recognition' | 'handler-table' | 'router-topology' | 'validated-helper-call' | 'derived-association';
  /** Closed producer allowlist supplied by AN9-01/02, never user text. */
  producer: string;
}
export interface HandlerDefinition {
  /** Existing report handler ID, or analytics helper ID; see identity policy. */
  id: string;
  canonicalId: string;
  kind: 'handler' | 'helper';
  name: string | null;
  source: Fact<Span>;
  /** Trusted linker source identity, not inferred from a display name. */
  package: Fact<{ name: string; version: string; sourceIdentity: string }>;
  evidence: Evidence[];
}
export interface Registration {
  /** Existing report entry ID, distinct for each mount expansion. */
  id: string;
  canonicalId: string;
  handlerId: string | null; // Null for mount/synthetic entries.
  kind: 'route' | 'middleware' | 'mount' | 'error' | 'event' | 'fallback';
  authored: boolean;
  source: Fact<Span>; // Registration expression, not handler declaration.
  routerId: string;
  routerPath: string[]; // Definition path alone does not identify a mount instance.
  mountPath: string[]; // Ordered registration IDs; derived from canonical child/return links.
  order: number;
  match: Fact<{ method: string | null; path: string | null; eventType: string | null }>;
  flow: { next: string | null; child: string | null; parentContinue: string | null };
  evidence: Evidence[];
}
export type BindingUse =
  | { state: 'resolved'; kind: string; referenceId: string; bindingId: string; reason: null }
  | { state: 'dynamic' | 'unknown'; kind: string; referenceId: string | null; bindingId: null; reason: string }
  | { state: 'not-applicable'; kind: null; referenceId: null; bindingId: null; reason: 'no-named-binding' };
export interface UseSite {
  id: string;
  ownerId: string; // Handler/helper definition ID, not consolidated stage ID.
  surfaceId: string;
  operation: string; // Canonical operation, not a recreated UI capability taxonomy.
  capability: Fact<string>;
  binding: BindingUse;
  source: Fact<Span>;
  evidence: Evidence[];
}
export interface HelperCall {
  id: string;
  canonicalId: string | null;
  callerId: string;
  calleeId: string;
  /** Canonical consumer registration(s), including validated shared-stage callers. */
  registrationIds: string[];
  source: Fact<Span>;
  evidence: Evidence[];
}
export interface Association {
  id: string;
  consumerRegistrationId: string;
  useSiteId: string;
  /** Ordered explanation, not runtime trace: IDs reference records above. */
  via: { kind: 'direct' | 'middleware' | 'mount' | 'helper' | 'error'; id: string }[];
  lane: 'normal' | 'error' | 'event';
  /** Null means unavailable control evidence. False never means executed. */
  conditional: boolean | null;
  coverage: Coverage;
  evidence: Evidence[];
}
export interface ReportAnalyticsV1 {
  version: 'pulse.report-analytics.v1';
  handlers: HandlerDefinition[];
  registrations: Registration[];
  useSites: UseSite[];
  helperCalls: HelperCall[];
  associations: Association[];
  coverage: Record<'handlers' | 'registrations' | 'useSites' | 'helperCalls' | 'associations', Coverage>;
}
/** Absence means an older producer / unavailable analytics, never an empty graph. */
export interface ProposedReportExtension { analytics?: ReportAnalyticsV1 }
