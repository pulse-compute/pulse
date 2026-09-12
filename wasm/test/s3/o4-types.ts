import { s3, type S3GetTextResult, type S3HeadResult, type S3PutTextResult } from '@pulse-compute/s3'
import type { PulseContext } from '@pulse-compute/runtime'

export async function consume(ctx: PulseContext, key: string, text: string) {
  const write: S3PutTextResult = await s3.putText(ctx, 'objects', key, text, { contentType: 'application/json' })
  const read = await ctx.parallel({
    metadata: s3.head(ctx, 'objects', key),
    object: s3.getText(ctx, 'objects', key),
  })
  const metadata: S3HeadResult = read.metadata
  const object: S3GetTextResult = read.object
  if (object.status === 'found') {
    const exactText: string = object.text
    const digest: string = object.sha256
    void [exactText, digest]
  }
  if (write.status === 'unknown') {
    // Uncertain writes cannot expose a successful receipt.
    // @ts-expect-error unknown results have no digest
    void write.sha256
  }
  // @ts-expect-error text-only contract rejects byte-array uploads
  s3.putText(ctx, 'objects', key, new Uint8Array())
  return { write, metadata, object }
}
