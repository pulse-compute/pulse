/** Release a provider-owned body that will not be returned to the caller. */
export async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is ownership cleanup. A transport that already closed the
    // stream must not replace the routing or HEAD result with a cleanup error.
  }
}
