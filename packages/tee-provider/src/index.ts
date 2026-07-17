export type {
  TeeInstanceStatus,
  TeeInstance,
  InstanceSelectionCriteria,
  RouteRequestPayload,
  RouteRequestResult,
  TeeProvider,
} from './types.js';

export { selectFromPool } from './select-instance.js';

export type {
  RejectedInstance,
  VerifiedTeeSession,
  GetVerifiedInstanceResult,
  GetVerifiedInstanceOptions,
} from './get-verified-instance.js';
export { getVerifiedInstance, routeVerifiedRequest, UnverifiedInstanceError } from './get-verified-instance.js';

export type { BuildMockTeeInstanceOptions } from './mock-provider.js';
export {
  MOCK_TEE_SIGNING_KEY,
  createMockTeeSignatureVerifier,
  buildMockTeeInstance,
  MockTeeProvider,
} from './mock-provider.js';
