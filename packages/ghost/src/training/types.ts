export interface TrainingPair {
  id: string;
  /** Base64 FHE ciphertext — the user's instruction is never stored in plaintext */
  encryptedInput: string;
  /** Base64 FHE ciphertext — the execution plan is never stored in plaintext */
  encryptedOutput: string;
  outcome: 'success' | 'failed' | 'cancelled';
  txHash?: string;
  timestamp: number;
  nodeId: string;
  /** Octra Circle that holds this pair */
  circleId?: string;
}

export interface TrainingRound {
  roundId: string;
  startTime: number;
  nodeCount: number;
  pairsProcessed: number;
  encryptedModelHash: string;
  status: 'pending' | 'aggregating' | 'complete' | 'failed';
}
