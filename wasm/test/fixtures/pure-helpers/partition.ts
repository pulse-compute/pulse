import type { PartitionHead } from './types';

export function validPartition(
  head: PartitionHead,
  subjectKind: string,
  subjectId: string,
  partition: number,
): boolean {
  if (head.subjectKind !== subjectKind || head.subjectId !== subjectId) return false;
  if (partition < 0 || partition >= 16 || partition % 1 !== 0) return false;
  if (head.partition !== partition) return false;
  if (head.revision < 0 || head.revision > 2147483647 || head.revision % 1 !== 0) return false;
  if (head.root.hash === '' || head.root.node < 0 || head.root.node > 2147483647 || head.root.node % 1 !== 0) return false;
  if (head.counters.length !== 10) return false;
  for (let i = 0; i < 10; i++) {
    const count = head.counters[i];
    if (count < 0 || count > 2147483647 || count % 1 !== 0) return false;
  }
  return true;
}
