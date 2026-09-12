import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';
import { s3 } from '@pulse-compute/s3';
import type { S3GetTextResult } from '@pulse-compute/s3';

export async function contract(ctx: PulseContext, key: string, text: string) {
  const pending: PulseParallelEffect<S3GetTextResult> = s3.getText(ctx, 'objects', key);
  const read = await pending;
  if (read.status === 'found') {
    const body: string = read.text;
    const length: number = read.byteLength;
    const digest: string = read.sha256;
    void [body, length, digest];
  } else {
    // @ts-expect-error failures and absence never contain object text
    read.text;
  }
  const pair = await ctx.parallel({
    metadata: s3.head(ctx, 'objects', key),
    object: s3.getText(ctx, 'objects', key),
  });
  if (pair.metadata.status === 'found') {
    // @ts-expect-error ETag cannot be substituted for an exact-byte digest
    pair.metadata.sha256;
  }
  const write = await s3.putText(ctx, 'objects', key, text, { contentType: 'application/json' });
  if (write.status === 'stored') {
    const digest: string = write.sha256;
    void digest;
  } else {
    // @ts-expect-error unknown and rejected writes carry no successful upload receipt
    write.sha256;
  }
  // @ts-expect-error bounded text only, no binary masquerading as structured data
  s3.putText(ctx, 'objects', key, new Uint8Array());
  // @ts-expect-error no guest endpoint, credentials, headers, or signer injection
  s3.getText(ctx, 'objects', key, { endpoint: 'https://example.invalid' });
  // @ts-expect-error no conditional writes or arbitrary signing options
  s3.putText(ctx, 'objects', key, text, { ifNoneMatch: '*' });
  // @ts-expect-error no guest-owned credential input
  s3.putText(ctx, 'objects', key, text, { secretAccessKey: 'forbidden' });
  // @ts-expect-error no list/delete surface in this subset
  s3.delete(ctx, 'objects', key);
}
