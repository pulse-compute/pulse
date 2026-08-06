export class AssetBucketConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetBucketConfigError";
  }
}

export class AssetBucketSignError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AssetBucketSignError";
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AssetBucketFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AssetBucketFetchError";
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
