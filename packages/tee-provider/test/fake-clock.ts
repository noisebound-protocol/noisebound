import type { Clock } from '@noisebound/attest';

export class FakeClock implements Clock {
  constructor(private currentMs: number) {}

  now(): Date {
    return new Date(this.currentMs);
  }

  advanceMs(deltaMs: number): void {
    this.currentMs += deltaMs;
  }
}
