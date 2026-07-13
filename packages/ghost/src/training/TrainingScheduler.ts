import type { FederatedCoordinator } from './FederatedCoordinator.js';
import type { GhostTrainer } from './GhostTrainer.js';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface TrainingSchedulerStatus {
  lastRound: number;
  nextRound: number;
  queueSize: number;
}

/**
 * Triggers federated training rounds when the encrypted pair queue fills up,
 * when the configured time interval elapses, or on manual request.
 */
export class TrainingScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private lastRound = 0;
  private nextRound = 0;
  private coordinator?: FederatedCoordinator;
  private trainer?: GhostTrainer;

  constructor(private readonly intervalMs: number = DEFAULT_INTERVAL_MS) {}

  start(coordinator: FederatedCoordinator, trainer: GhostTrainer): void {
    this.coordinator = coordinator;
    this.trainer = trainer;
    this.lastRound = Date.now();
    this.nextRound = this.lastRound + this.intervalMs;

    this.timer = setInterval(() => {
      void this.triggerNow();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Manually triggers a training round, e.g. from an API endpoint. */
  async triggerNow(): Promise<void> {
    if (!this.coordinator) return;
    await this.coordinator.initiateTrainingRound();
    this.lastRound = Date.now();
    this.nextRound = this.lastRound + this.intervalMs;
  }

  getStatus(): TrainingSchedulerStatus {
    return {
      lastRound: this.lastRound,
      nextRound: this.nextRound,
      queueSize: this.trainer?.queueSize ?? 0,
    };
  }
}
