declare const catalog: {
  readonly ENTITIES_CATALOG_TARGETS: readonly ['fastly-javascript', 'fastly-native', 'node-javascript', 'node-native'];
  normalizeEligibility(input?: Readonly<Record<string, boolean>>): Readonly<Record<string, boolean>>;
  normalizeEntityCatalog(input: unknown): Readonly<Record<string, unknown>>;
};

export = catalog;
