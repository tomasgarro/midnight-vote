import { createHmac } from 'node:crypto';
import type { CivicActionKind } from 'midnight-referendum-api';

export interface ActionCapabilityIssuanceRequest {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly credentialAuthorization: string;
}

/**
 * A short public fingerprint of the capability secret.
 *
 * The relay holds the same secret and publishes the same fingerprint, so an
 * operator can see from outside that the two were given the same value. It is
 * a keyed hash of a constant, cut to 64 bits. It signs nothing, and it tells
 * no more about the secret than any capability this service hands out. The
 * relay computes it in its own package; a shared test vector holds the two
 * together.
 */
export function capabilityKeyId(secret: string): string {
  return createHmac('sha256', secret)
    .update('midnight-referendum:v2-capability:key-id:1')
    .digest('hex')
    .slice(0, 16);
}

export interface ActionCapabilityIssuer {
  issue(request: ActionCapabilityIssuanceRequest): Promise<string>;
}

export interface HmacActionCapabilityIssuerOptions {
  readonly secret: string;
  readonly credentialAuthorizationExists: (handle: string) => Promise<boolean>;
  readonly allowedNetworks: readonly string[];
  readonly allowedContracts: readonly string[];
  readonly allowedCircuits: readonly string[];
  readonly ttlSeconds?: number;
  readonly nowSeconds?: () => number;
}

/**
 * CICO-side issuer. It verifies the opaque credential issuance handle and
 * signs only public relay-routing fields. The credential handle is not placed
 * in the token and therefore never reaches the relay.
 */
export class HmacActionCapabilityIssuer implements ActionCapabilityIssuer {
  private readonly ttlSeconds: number;
  private readonly nowSeconds: () => number;

  constructor(private readonly options: HmacActionCapabilityIssuerOptions) {
    if (options.secret.length < 32) throw new TypeError('Action capability secret is too short');
    if (
      options.allowedNetworks.length === 0 ||
      options.allowedContracts.length === 0 ||
      options.allowedCircuits.length === 0
    ) {
      throw new TypeError('Action capability allowlists must not be empty');
    }
    this.ttlSeconds = options.ttlSeconds ?? 120;
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds < 15 || this.ttlSeconds > 600) {
      throw new TypeError('Action capability TTL must be between 15 and 600 seconds');
    }
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  }

  async issue(request: ActionCapabilityIssuanceRequest): Promise<string> {
    validateRequest(request);
    if (!this.options.allowedNetworks.includes(request.network)) throw new ActionCapabilityError();
    if (!this.options.allowedContracts.includes(request.contractAddress))
      throw new ActionCapabilityError();
    if (!this.options.allowedCircuits.includes(request.circuit)) throw new ActionCapabilityError();
    if (actionForCircuit(request.circuit) !== request.action) throw new ActionCapabilityError();
    if (!(await this.options.credentialAuthorizationExists(request.credentialAuthorization))) {
      throw new ActionCapabilityError();
    }
    const payload = base64Url(
      JSON.stringify({
        v: 1,
        actionId: request.actionId,
        idempotencyKey: request.idempotencyKey,
        network: request.network,
        contractAddress: request.contractAddress,
        circuit: request.circuit,
        action: request.action,
        requestHash: request.requestHash,
        expiresAt: this.nowSeconds() + this.ttlSeconds,
      }),
    );
    const signature = createHmac('sha256', this.options.secret)
      .update(`midnight-referendum:v2-capability:1:${payload}`)
      .digest();
    return `${payload}.${base64Url(signature)}`;
  }
}

export class ActionCapabilityError extends Error {
  readonly status = 403;

  constructor() {
    super('Credential is not authorized for this action');
    this.name = 'ActionCapabilityError';
  }
}

function validateRequest(request: ActionCapabilityIssuanceRequest): void {
  for (const value of [
    request.actionId,
    request.idempotencyKey,
    request.network,
    request.contractAddress,
    request.circuit,
    request.credentialAuthorization,
  ]) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      throw new ActionCapabilityError();
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(request.requestHash)) throw new ActionCapabilityError();
  if (request.action !== 'credential' && request.action !== 'vote' && request.action !== 'cohort') {
    throw new ActionCapabilityError();
  }
}

function actionForCircuit(circuit: string): CivicActionKind | undefined {
  // This issuer is authenticated by a citizen's credential authorization.
  // Organizer and issuer circuits require a distinct role-bound capability
  // issuer; treating every referendum mutation as a "vote" would allow a
  // credential holder to request close or finalize authority.
  //
  // revealVote is a citizen circuit: it counts one answer and only succeeds
  // for whoever knows that answer's opening, which stays on the voter's
  // device (ADR-009). The capability pays the fee; it grants no authority.
  if (circuit === 'castVote' || circuit === 'revealVote') return 'vote';
  return undefined;
}

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}
