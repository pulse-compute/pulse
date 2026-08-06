import packageRuntime from '@pulse-compute/runtime/package';

export const pulseJwtRuntime = packageRuntime.createPackageRuntime({
  package: '@pulse-compute/jwt',
  contractId: 'pulse.jwt',
  providerKind: 'jwt',
  operations: {
    verify: {
      kind: 'jwt.verify',
      capability: 'jwt.verify',
      result: 'jwt-verification',
    },
  },
} as const);
