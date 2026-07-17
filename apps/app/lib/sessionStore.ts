import type { StoredSessionCapability } from './types';

const STORAGE_KEY = 'noisebound.sessionCapabilities.v1';

export function loadStoredSessionCapabilities(): StoredSessionCapability[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    return JSON.parse(raw) as StoredSessionCapability[];
  } catch {
    return [];
  }
}

export function saveStoredSessionCapabilities(capabilities: StoredSessionCapability[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capabilities));
}
