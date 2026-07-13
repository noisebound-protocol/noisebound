/** In-memory nonce store for replay prevention. Production deployments need a persistent store. */
export class NonceStore {
  private readonly store = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlSeconds = 600) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Returns true and records the nonce if it has not been seen within the TTL window.
   * Returns false if the nonce was already seen (replay detected).
   */
  checkAndStoreNonce(nonce: string): boolean {
    this.evict();
    if (this.store.has(nonce)) return false;
    this.store.set(nonce, Date.now());
    return true;
  }

  private evict(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [nonce, ts] of this.store) {
      if (ts < cutoff) this.store.delete(nonce);
    }
  }
}
