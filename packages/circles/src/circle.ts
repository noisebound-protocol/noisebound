/**
 * Circle lifecycle — deploy, retrieve, and interact with Octra Circles.
 *
 * CURRENT STATUS (honest):
 *   Circle deployment requires Octra's `light-node` CLI with a compiled
 *   circle.json + program binary. There is no documented REST API for
 *   deploying Circles remotely today.
 *
 *   Circle execution uses the browser-native window.OctraCircle.request()
 *   API inside a running sealed Circle, not an external RPC call.
 *
 *   Both deployCircle() and Circle.execute() are therefore cleanly mocked
 *   with the correct interface. When Octra's SDK ships a Node.js deploy
 *   path, replace the TODO sections below.
 *
 * REFERENCE:
 *   circle.json format: https://github.com/octra-labs/circle_examples
 *   program.call / program.view API: aml_circle_counter/site/app.js
 */

import { sha256 } from '@noble/hashes/sha256';
import type { CircleConfig, CircleInputs, CircleResult, CircleState } from './types.js';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Derives a deterministic Circle address from name + deployer address. */
function deriveCircleAddress(name: string, deployerAddress: string): string {
  const input = new TextEncoder().encode(`circle:${name}:${deployerAddress}`);
  const hash = sha256(input);
  return '0x' + toHex(hash.slice(0, 20));
}

export class Circle {
  readonly address: string;
  readonly name: string;
  readonly deploymentTx: string;

  private _state: Record<string, unknown>;

  constructor(
    address: string,
    name: string,
    deploymentTx: string,
    initialState: Record<string, unknown> = {},
  ) {
    this.address = address;
    this.name = name;
    this.deploymentTx = deploymentTx;
    this._state = { ...initialState };
  }

  /**
   * Sends an encrypted instruction to the Circle for execution.
   *
   * Maps to Octra's program.call / program.view browser API:
   *   window.OctraCircle.request('program.call', { method, params, amount, ou })
   *   window.OctraCircle.request('program.view', { method, params })
   *
   * TODO: wire into Octra's sealed Circle execution environment when
   * a Node.js RPC path for program.call becomes available.
   */
  async execute(instruction: string, inputs: CircleInputs): Promise<CircleResult> {
    const txHash =
      '0x' +
      toHex(sha256(new TextEncoder().encode(`${this.address}:${instruction}:${Date.now()}`))).slice(0, 32);

    // Simulate state mutation for known methods
    if (inputs.method === 'inc') {
      const counter = (typeof this._state.counter === 'number' ? this._state.counter : 0) + 1;
      this._state = { ...this._state, counter };
      return { success: true, value: counter, txHash };
    }

    return {
      success: true,
      value: this._state[inputs.method] ?? null,
      txHash,
    };
  }

  /**
   * Returns the current state fields of this Circle.
   *
   * Maps to window.OctraCircle.request('program.view', { method: 'get_*', params: [] })
   *
   * TODO: wire into live Circle state query when Octra Node.js SDK ships.
   */
  async getState(): Promise<CircleState> {
    return {
      address: this.address,
      fields: { ...this._state },
      lastUpdated: Date.now(),
    };
  }

  /**
   * Returns true if this Circle's sealed execution environment is intact.
   *
   * TODO: wire into Octra's circle integrity attestation API.
   */
  async isSealed(): Promise<boolean> {
    // Mock: deployed Circles are always sealed in this interface.
    // Real implementation checks Octra's runtime_guard view method:
    //   window.OctraCircle.request('program.view', { method: 'runtime_guard', params: [] })
    return true;
  }
}

/**
 * Deploys an AppliedML or WASM program as a sealed Circle on Octra.
 *
 * TODO: replace mock with real deployment when Octra ships a Node.js
 * deploy API. Today, deployment requires:
 *   1. Compile program: `octra build circle.json`
 *   2. Deploy via light-node: `octra deploy --circle circle.json`
 *   3. Get back the Circle address from the deploy receipt
 *
 * The circle.json format is documented at:
 *   https://github.com/octra-labs/circle_examples/blob/main/aml_circle_counter/circle.json
 */
export async function deployCircle(config: CircleConfig): Promise<Circle> {
  const deployerAddress = config.keypair.address;
  const circleAddress = deriveCircleAddress(config.name, deployerAddress);

  const deploymentTx =
    '0x' +
    toHex(
      sha256(
        new TextEncoder().encode(
          `deploy:${config.name}:${deployerAddress}:${config.programRuntime}`,
        ),
      ),
    );

  return new Circle(
    circleAddress,
    config.name,
    deploymentTx,
    config.initialState ?? {},
  );
}

/**
 * Retrieves a Circle handle by its on-chain address.
 *
 * TODO: query Octra's program.info endpoint for the live Circle descriptor:
 *   window.OctraCircle.request('program.info')
 * and reconstruct the Circle with its current state.
 */
export async function getCircle(address: string): Promise<Circle> {
  return new Circle(address, `circle-${address.slice(2, 10)}`, '0x' + '0'.repeat(64));
}
