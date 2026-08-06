import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';

export interface RealityInput {
  name: string;
  active: boolean;
}

export interface RealityOriginUser {
  id: number;
  authSeen: boolean;
}

export interface RealityOutput {
  id: number;
  name: string;
  active: boolean;
  stored: string;
  authSeen: boolean;
}

export interface RealityStored {
  stored: string;
}

export default defineSchemaRegistry({
  schemas: {
    'reality.Input': schema<RealityInput>(),
    'reality.OriginUser': schema<RealityOriginUser>(),
    'reality.Output': schema<RealityOutput>(),
    'reality.Stored': schema<RealityStored>(),
  },
});
