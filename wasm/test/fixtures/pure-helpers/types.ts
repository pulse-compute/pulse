// Mutable authoring types are intentional: the future callee contract enforces
// read-only access rather than requiring authors to replace their interfaces.
export interface PartitionHead {
  subjectKind: string;
  subjectId: string;
  partition: number;
  revision: number;
  root: { hash: string; node: number };
  counters: number[];
}
