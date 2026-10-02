import { asContractAddress, type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  type CanonicalReceipt,
  type CredentialRegistryV1Executor,
  type CredentialRegistryV1PrivateState,
  type CredentialRegistryV1State,
  createFrozenCredentialRegistryReference,
  type FrozenCredentialRegistryReference,
  parseCredentialRegistryV1,
} from 'midnight-referendum-api';

export type CredentialEpochPhase = 'enrollment-open' | 'frozen';

export interface CredentialEpochSnapshot extends CredentialRegistryV1State {
  readonly registryContractAddress: string;
  readonly phase: CredentialEpochPhase;
}

export interface CredentialEpochReader {
  readRegistry(registryContractAddress: string): Promise<CredentialEpochSnapshot>;
}

export interface CredentialEpochMutationBoundary {
  runEnrollmentMutation<T>(operation: () => Promise<T>): Promise<T>;
}

export interface CredentialEpochFreezeResult {
  readonly outcome: 'frozen' | 'already-frozen';
  readonly before: CredentialEpochSnapshot;
  readonly after: CredentialEpochSnapshot;
  readonly reference: FrozenCredentialRegistryReference;
  readonly receipt?: CanonicalReceipt;
}

export interface CredentialEpochCoordinatorOptions {
  readonly executor: CredentialRegistryV1Executor;
  readonly reader: CredentialEpochReader;
  readonly registryContractAddress: string;
  readonly registryId: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly credentialEpoch: bigint;
  readonly issuerSecret: Uint8Array;
  readonly reconciliationAttempts?: number;
  readonly reconciliationDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/** Reads the canonical ledger through the indexer; caller-supplied roots are never trusted. */
export class MidnightCredentialEpochReader implements CredentialEpochReader {
  constructor(private readonly publicDataProvider: PublicDataProvider) {}

  async readRegistry(registryContractAddress: string): Promise<CredentialEpochSnapshot> {
    const address = asContractAddress(registryContractAddress);
    const canonical = await this.publicDataProvider.queryContractState(address);
    if (!canonical) throw new Error('Canonical credential registry state is unavailable');
    const state = parseCredentialRegistryV1(canonical.data);
    return {
      ...state,
      registryContractAddress: String(address),
      phase: state.frozen ? 'frozen' : 'enrollment-open',
    };
  }
}

/**
 * Serializes issuance and freeze in one process, freezes only the current
 * canonical root, and independently re-reads the indexer before returning a
 * referendum-safe registry reference.
 */
export class CredentialEpochCoordinator implements CredentialEpochMutationBoundary {
  private readonly executor: CredentialRegistryV1Executor;
  private readonly reader: CredentialEpochReader;
  private readonly registryContractAddress: string;
  private readonly registryId: Uint8Array;
  private readonly issuerId: Uint8Array;
  private readonly credentialEpoch: bigint;
  private readonly issuerSecret: Uint8Array;
  private readonly reconciliationAttempts: number;
  private readonly reconciliationDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: CredentialEpochCoordinatorOptions) {
    if (!options.registryContractAddress.trim()) {
      throw new TypeError('registryContractAddress must not be empty');
    }
    this.executor = options.executor;
    this.reader = options.reader;
    this.registryContractAddress = options.registryContractAddress;
    this.registryId = requireBytes32(options.registryId, 'registryId');
    this.issuerId = requireBytes32(options.issuerId, 'issuerId');
    if (options.credentialEpoch < 0n) {
      throw new TypeError('credentialEpoch must be non-negative');
    }
    this.credentialEpoch = options.credentialEpoch;
    this.issuerSecret = requireBytes32(options.issuerSecret, 'issuerSecret');
    this.reconciliationAttempts = requirePositiveInteger(
      options.reconciliationAttempts ?? 8,
      'reconciliationAttempts',
    );
    this.reconciliationDelayMs = requireNonNegativeInteger(
      options.reconciliationDelayMs ?? 250,
      'reconciliationDelayMs',
    );
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async getStatus(): Promise<CredentialEpochSnapshot> {
    return this.readExpectedRegistry();
  }

  runEnrollmentMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const before = await this.readExpectedRegistry();
      if (before.frozen) {
        throw new Error('Credential enrollment is closed for this frozen epoch');
      }
      return operation();
    });
  }

  /**
   * Runs one transaction that is neither an issuance nor a freeze, in the same
   * queue. The service pays for everything from one wallet, and two
   * transactions built at the same moment would spend the same DUST. The
   * registry executor also holds one private state, which each caller sets
   * before its own circuit.
   */
  runWalletMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.exclusive(operation);
  }

  closeAndFreeze(): Promise<CredentialEpochFreezeResult> {
    return this.exclusive(async () => {
      const before = await this.readExpectedRegistry();
      if (before.frozen) {
        assertFrozenRootIsCurrent(before);
        return {
          outcome: 'already-frozen',
          before,
          after: before,
          reference: createFrozenCredentialRegistryReference(this.registryContractAddress, before),
        };
      }
      if (before.credentialCount === 0n) {
        throw new Error('Refusing to freeze an empty credential epoch');
      }

      await this.executor.join(this.registryContractAddress, freezePrivateState(this.issuerSecret));
      const receipt = await this.executor.freeze(before.currentRoot);
      assertFreezeReceipt(receipt, this.registryContractAddress);
      const after = await this.reconcileFrozen(before);
      return {
        outcome: 'frozen',
        before,
        after,
        reference: createFrozenCredentialRegistryReference(this.registryContractAddress, after),
        receipt,
      };
    });
  }

  private async reconcileFrozen(before: CredentialEpochSnapshot): Promise<CredentialEpochSnapshot> {
    for (let attempt = 0; attempt < this.reconciliationAttempts; attempt += 1) {
      const after = await this.readExpectedRegistry();
      if (after.frozen) {
        if (after.frozenRoot.field !== before.currentRoot.field) {
          throw new Error(
            'Canonical registry froze a root other than the coordinated current root',
          );
        }
        if (after.currentRoot.field !== before.currentRoot.field) {
          throw new Error('Canonical registry root changed while the epoch was freezing');
        }
        if (after.credentialCount !== before.credentialCount) {
          throw new Error('Canonical credential count changed while the epoch was freezing');
        }
        return after;
      }
      if (attempt + 1 < this.reconciliationAttempts) {
        await this.sleep(this.reconciliationDelayMs);
      }
    }
    throw new Error('Indexer did not reconcile the frozen credential epoch in time');
  }

  private async readExpectedRegistry(): Promise<CredentialEpochSnapshot> {
    const state = await this.reader.readRegistry(this.registryContractAddress);
    if (state.registryContractAddress !== this.registryContractAddress) {
      throw new Error('Canonical registry address does not match the configured epoch');
    }
    if (!equalBytes(state.registryId, this.registryId)) {
      throw new Error('Canonical registry ID does not match the configured epoch');
    }
    if (!equalBytes(state.issuerId, this.issuerId)) {
      throw new Error('Canonical issuer ID does not match the configured epoch');
    }
    if (state.credentialEpoch !== this.credentialEpoch) {
      throw new Error('Canonical credential epoch does not match configuration');
    }
    return state;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function freezePrivateState(issuerSecret: Uint8Array): CredentialRegistryV1PrivateState {
  const empty = () => new Uint8Array(32);
  return {
    issuerSecret: new Uint8Array(issuerSecret),
    holderBinding: empty(),
    credentialBlind: empty(),
    credentialCountry: empty(),
    credentialAgeClass: 0n,
    credentialAssurance: 0n,
    credentialClaimEpoch: 0n,
    credentialValidUntil: 0n,
  };
}

function assertFreezeReceipt(receipt: CanonicalReceipt, registryContractAddress: string): void {
  if (
    receipt.status !== 'confirmed' ||
    receipt.action !== 'credential' ||
    receipt.network !== 'preview' ||
    receipt.circuit !== 'freeze' ||
    receipt.contractAddress !== registryContractAddress
  ) {
    throw new Error('Credential registry did not return a canonical Preview freeze receipt');
  }
}

function assertFrozenRootIsCurrent(state: CredentialEpochSnapshot): void {
  if (state.frozenRoot.field !== state.currentRoot.field) {
    throw new Error('Frozen registry root is not the current canonical root');
  }
}

function requireBytes32(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
  return new Uint8Array(value);
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be positive`);
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be non-negative`);
  }
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
