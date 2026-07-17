import type { EscalationLogEntry } from './types';

const STORAGE_KEY = 'noisebound.escalationLog.v1';
const MAX_ENTRIES = 50;

export function loadEscalationLog(): EscalationLogEntry[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    return JSON.parse(raw) as EscalationLogEntry[];
  } catch {
    return [];
  }
}

export function appendEscalationLogEntry(entry: EscalationLogEntry): EscalationLogEntry[] {
  const next = [entry, ...loadEscalationLog()].slice(0, MAX_ENTRIES);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}
