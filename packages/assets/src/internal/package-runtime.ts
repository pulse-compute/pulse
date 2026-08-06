import packageRuntime from '@pulse-compute/runtime/package';

export const pulseAssetsRuntime = packageRuntime.createPackageRuntime({
  package: '@pulse-compute/assets',
  contractId: 'pulse.assets',
  providerKind: 'assets',
  operations: {
    lookup: {
      kind: 'assets.lookup',
      capability: 'assets.lookup',
      result: 'asset',
    },
  },
} as const);
