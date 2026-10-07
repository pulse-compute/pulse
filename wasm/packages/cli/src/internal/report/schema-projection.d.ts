import type { Structure } from './model';
export const DESCRIPTOR_VERSION: 'pulse.report-schema-shape.v1';
export const REGISTRY_VERSION: 'pulse.schema-registry-ir.v5';
export function projectSchema(schema: unknown, registryVersion?: string): Structure;
export function structureFromDescriptor(descriptor: unknown): Structure;
