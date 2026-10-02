import {
  ageClassCode,
  assuranceCode,
  CivicCredentialError,
  type CivicCredentialIssuanceRequest,
  type CivicCredentialIssuanceResult,
  type CivicCredentialIssuerPort,
  type CredentialRegistryV1Executor,
  type CredentialRegistryV1PrivateState,
  deriveCredentialLeaf,
  isoTimestampSeconds,
  padBytes32,
} from 'midnight-referendum-api';
import type { CredentialEpochMutationBoundary } from './credential-epoch-coordinator.js';
import {
  type CredentialIssuanceStore,
  type DocumentBindingStore,
  issuanceFingerprint,
} from './durable-stores.js';

export interface EvidenceAuthorizationStore {
  /** Atomically claims the opaque authorization for this enrollment; same-enrollment retry is valid. */
  claim(
    evidenceAuthorization: string,
    enrollmentId: string,
    issuanceMaterial: string,
  ): Promise<boolean>;
}

export interface CredentialIssuerServiceOptions {
  readonly executor: CredentialRegistryV1Executor;
  readonly registryContractAddress: string;
  readonly issuerSecret: Uint8Array;
  readonly evidenceAuthorizations: EvidenceAuthorizationStore;
  /** Shared with the epoch coordinator so issuance cannot race a canonical freeze. */
  readonly epochMutations?: CredentialEpochMutationBoundary;
  /** Re-derives the allowed claims from trusted verified evidence; the browser is never trusted. */
  readonly validateEvidenceAuthorization: (
    request: CivicCredentialIssuanceRequest,
  ) => Promise<boolean>;
  /** Optional local idempotency journal used across service restarts. */
  readonly issuanceStore?: CredentialIssuanceStore;
  readonly randomBytes?: (length: number) => Uint8Array;
  /** One holder per document. Absent: a document may be issued any number of passes. */
  readonly documentHolders?: DocumentHolderPolicy;
}

/**
 * One document, one holder, for a registry epoch.
 *
 * A consultation takes one answer per holder: its nullifier is drawn from the
 * holder's secret. So "one answer per document" holds exactly when a document
 * cannot have two holders. The same holder may be issued a pass again, which
 * is how a pass that expired is renewed, and it still answers once.
 */
export interface DocumentHolderPolicy {
  /**
   * The opaque tag of the document behind a verified authorization. Null when
   * the proof showed no nullifier; undefined when the authorization is unknown.
   */
  readonly tagFor: (evidenceAuthorization: string) => string | null | undefined;
  readonly bindings: DocumentBindingStore;
  /** `observe` records and reports, and refuses nothing. */
  readonly mode: 'enforce' | 'observe';
  readonly report?: (
    outcome: 'bound' | 'renewed' | 'refused' | 'would-refuse' | 'no-nullifier',
  ) => void;
}

/** Canonical Preview issuer; it serializes registry mutations and never receives voter secrets. */
export class CredentialIssuerService implements CivicCredentialIssuerPort {
  readonly adapterName = 'cico-midnight-credential-issuer-v1';

  private readonly executor: CredentialRegistryV1Executor;
  private readonly registryContractAddress: string;
  private readonly issuerSecret: Uint8Array;
  private readonly evidenceAuthorizations: EvidenceAuthorizationStore;
  private readonly epochMutations?: CredentialEpochMutationBoundary;
  private readonly validateEvidenceAuthorization: CredentialIssuerServiceOptions['validateEvidenceAuthorization'];
  private readonly issuanceStore?: CredentialIssuanceStore;
  private readonly documentHolders?: DocumentHolderPolicy;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly issuances = new Map<
    string,
    { readonly fingerprint: string; readonly operation: Promise<CivicCredentialIssuanceResult> }
  >();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: CredentialIssuerServiceOptions) {
    if (!options.registryContractAddress.trim()) {
      throw new TypeError('registryContractAddress must not be empty');
    }
    this.executor = options.executor;
    this.registryContractAddress = options.registryContractAddress;
    this.issuerSecret = requireBytes32(options.issuerSecret, 'issuerSecret');
    this.evidenceAuthorizations = options.evidenceAuthorizations;
    this.epochMutations = options.epochMutations;
    this.validateEvidenceAuthorization = options.validateEvidenceAuthorization;
    this.issuanceStore = options.issuanceStore;
    this.documentHolders = options.documentHolders;
    this.randomBytes = options.randomBytes ?? secureRandomBytes;
  }

  async issueCredential(
    request: CivicCredentialIssuanceRequest,
  ): Promise<CivicCredentialIssuanceResult> {
    const fingerprint = requestFingerprint(request);
    const existing = this.issuances.get(request.enrollmentId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new CivicCredentialError(
          'CONFLICT',
          'Enrollment was already used with different credential material',
        );
      }
      return existing.operation;
    }
    const operation = this.enqueue(() => this.issueOnce(request, fingerprint));
    this.issuances.set(request.enrollmentId, { fingerprint, operation });
    try {
      return await operation;
    } catch (error) {
      if (this.issuances.get(request.enrollmentId)?.operation === operation) {
        this.issuances.delete(request.enrollmentId);
      }
      throw error;
    }
  }

  private async issueOnce(
    request: CivicCredentialIssuanceRequest,
    fingerprint: string,
  ): Promise<CivicCredentialIssuanceResult> {
    const issuanceStore = this.issuanceStore;
    const fingerprintHash = issuanceStore ? issuanceFingerprint(fingerprint) : undefined;
    const persisted = issuanceStore ? await issuanceStore.get(request.enrollmentId) : null;
    if (persisted) {
      if (!fingerprintHash || persisted.fingerprintHash !== fingerprintHash) {
        throw new CivicCredentialError(
          'CONFLICT',
          'Enrollment was already used with different credential material',
        );
      }
      return cloneIssuanceResult(persisted.result);
    }
    if (!(await this.validateEvidenceAuthorization(request))) {
      throw new CivicCredentialError(
        'INVALID_CREDENTIAL_CLAIMS',
        'Verified evidence does not authorize this credential material',
      );
    }
    const credentialBlind = requireBytes32(this.randomBytes(32), 'credentialBlind');
    const privateState = privateStateFor(request, this.issuerSecret, credentialBlind);
    const mutate = async () => {
      // Before the evidence is spent and before anything goes on chain.
      await this.assertDocumentHolder(request);
      if (
        !(await this.evidenceAuthorizations.claim(
          request.evidenceAuthorization,
          request.enrollmentId,
          fingerprint,
        ))
      ) {
        throw new CivicCredentialError(
          'INVALID_CREDENTIAL_CLAIMS',
          'Evidence authorization is invalid, expired, or already claimed',
        );
      }
      await this.executor.join(this.registryContractAddress, privateState);
      return this.executor.addCredential();
    };
    const receipt = this.epochMutations
      ? await this.epochMutations.runEnrollmentMutation(mutate)
      : await mutate();
    if (
      receipt.status !== 'confirmed' ||
      receipt.action !== 'credential' ||
      receipt.circuit !== 'addCredential' ||
      receipt.contractAddress !== this.registryContractAddress ||
      receipt.network !== 'preview'
    ) {
      throw new CivicCredentialError(
        'ISSUANCE_FAILED',
        'Credential registry did not return a canonical Preview issuance',
        true,
      );
    }
    const credentialLeaf = deriveCredentialLeaf({
      holderBinding: request.holderBinding,
      claims: request.claims,
      credentialBlind,
    });
    const result = {
      issuanceId: `credential:${receipt.transactionId}`,
      credentialBlind: new Uint8Array(credentialBlind),
      credentialLeaf,
      receipt,
    };
    if (issuanceStore && fingerprintHash) {
      await issuanceStore.put(request.enrollmentId, fingerprintHash, result);
    }
    return result;
  }

  private async assertDocumentHolder(request: CivicCredentialIssuanceRequest): Promise<void> {
    const policy = this.documentHolders;
    if (!policy) return;
    const enforce = policy.mode === 'enforce';
    const tag = policy.tagFor(request.evidenceAuthorization);
    if (!tag) {
      // A proof made without its nullifier cannot be told from another one of
      // the same document. Accepting it would be the way around this rule.
      policy.report?.('no-nullifier');
      if (enforce) {
        throw new CivicCredentialError(
          'INVALID_CREDENTIAL_CLAIMS',
          'The verification did not show the document nullifier this registry requires',
        );
      }
      return;
    }
    const outcome = await policy.bindings.bind(tag, bytesToHex(request.holderBinding));
    if (outcome === 'other') {
      policy.report?.(enforce ? 'refused' : 'would-refuse');
      if (enforce) {
        throw new CivicCredentialError(
          'DOCUMENT_ALREADY_ENROLLED',
          'This document already has a pass, held by another device or browser',
        );
      }
      return;
    }
    policy.report?.(outcome === 'bound' ? 'bound' : 'renewed');
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function cloneIssuanceResult(result: CivicCredentialIssuanceResult): CivicCredentialIssuanceResult {
  return {
    issuanceId: result.issuanceId,
    credentialBlind: new Uint8Array(result.credentialBlind),
    credentialLeaf: new Uint8Array(result.credentialLeaf),
    receipt: { ...result.receipt },
  };
}

function privateStateFor(
  request: CivicCredentialIssuanceRequest,
  issuerSecret: Uint8Array,
  credentialBlind: Uint8Array,
): CredentialRegistryV1PrivateState {
  return {
    issuerSecret: new Uint8Array(issuerSecret),
    holderBinding: requireBytes32(request.holderBinding, 'holderBinding'),
    credentialBlind: new Uint8Array(credentialBlind),
    credentialCountry: padBytes32(request.claims.country),
    credentialAgeClass: ageClassCode(request.claims.ageClass),
    credentialAssurance: assuranceCode(request.claims.assurance),
    credentialClaimEpoch: BigInt(request.claims.credentialEpoch),
    credentialValidUntil: isoTimestampSeconds(request.claims.validUntil, 'validUntil'),
  };
}

function requestFingerprint(request: CivicCredentialIssuanceRequest): string {
  return JSON.stringify({
    provider: request.provider,
    evidenceAuthorization: request.evidenceAuthorization,
    holderBinding: bytesToHex(request.holderBinding),
    claims: request.claims,
  });
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireBytes32(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
  return new Uint8Array(value);
}

function secureRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
