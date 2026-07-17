import type { SerializedIdentityKeyPair } from '@noisebound/identity';

const STORAGE_KEY = 'noisebound.identity.v1';

export function loadStoredIdentity(): SerializedIdentityKeyPair | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as SerializedIdentityKeyPair;
  } catch {
    return null;
  }
}

export function saveStoredIdentity(identity: SerializedIdentityKeyPair): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearStoredIdentity(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
