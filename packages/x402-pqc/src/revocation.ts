/**
 * In-memory revocation registry for capability tokens. Structurally parallel
 * to NonceStore: production deployments need a persistent, shared store —
 * this is single-process only.
 */
export class RevocationRegistry {
  private readonly store = new Map<string, number>(); // tokenId -> natural expiresAt (unix secs)

  /** Marks a token as revoked. `expiresAt` is the token's own expiry, used to bound the sweep. */
  revoke(tokenId: string, expiresAt: number): void {
    this.store.set(tokenId, expiresAt);
  }

  isRevoked(tokenId: string): boolean {
    this.evict();
    return this.store.has(tokenId);
  }

  /** A revoked token can be forgotten once it would have expired naturally anyway. */
  private evict(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [tokenId, expiresAt] of this.store) {
      if (expiresAt < now) this.store.delete(tokenId);
    }
  }
}