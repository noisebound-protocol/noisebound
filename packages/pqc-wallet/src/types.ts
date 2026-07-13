export interface PQCPublicKey {
  /** ML-DSA-65 verification key (1952 bytes) */
  dsa: Uint8Array;
  /** ML-KEM-768 encapsulation key (1184 bytes) */
  kem: Uint8Array;
}

export interface PQCKeypair {
  /** ML-DSA-65 signing secret key (4032 bytes) */
  signingKey: Uint8Array;
  /** ML-KEM-768 decapsulation secret key (2400 bytes) */
  encapsulationKey: Uint8Array;
  publicKey: PQCPublicKey;
  /** EVM-compatible address derived from keccak256(dsa public key)[-20 bytes] */
  address: string;
}

export interface X402PQCHeader {
  version: string;
  amount: string;
  recipient: string;
  timestamp: number;
  nonce: string;
  signature: string;
}
