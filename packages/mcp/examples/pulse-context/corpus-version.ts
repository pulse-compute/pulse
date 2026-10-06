import { contextCorpus } from './context-corpus.js';

/** v1 contains one immutable snapshot; aliases and unavailable versions never fall back. */
export function selectContextCorpus(requestedVersion: string) {
  if (requestedVersion !== contextCorpus.pulseVersion) {
    return { status: 'version-mismatch', requestedVersion, availableVersion: contextCorpus.pulseVersion } as const;
  }
  return { status: 'ok', corpus: contextCorpus } as const;
}
