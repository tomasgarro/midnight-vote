import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { describe, expect, it } from 'vitest';
import { Choice } from '../generated/referendum-v2/index.js';
import { deriveRegistryContractBinding } from './crypto.js';
import {
  assertCanonicalReferendumBinding,
  assertReferendumRegistryBinding,
  type CredentialRegistryV1State,
  choiceToGenerated,
  createCompiledCredentialRegistryV1,
  createCompiledReferendumV2,
  createFrozenCredentialRegistryReference,
  createOpenCredentialRegistryReference,
  type ReferendumV2AdmissionState,
} from './midnight-v2.js';

describe('Passport v2 compiled bindings', () => {
  it('keeps registry and referendum proving assets in separate namespaces', () => {
    expect(CompiledContract.getCompiledAssetsPath(createCompiledCredentialRegistryV1())).toBe(
      'managed/credential-registry-v1',
    );
    expect(CompiledContract.getCompiledAssetsPath(createCompiledReferendumV2())).toBe(
      'managed/referendum-v2',
    );
  });

  it('maps provider-neutral vote choices to the generated enum', () => {
    expect(choiceToGenerated('YES')).toBe(Choice.YES);
    expect(choiceToGenerated('NO')).toBe(Choice.NO);
    expect(choiceToGenerated('ABSTAIN')).toBe(Choice.ABSTAIN);
  });

  it('pins referendum deployment to one canonical frozen registry', () => {
    const registryId = new Uint8Array(32).fill(1);
    const issuerId = new Uint8Array(32).fill(2);
    const registryAddress = 'ab'.repeat(32);
    const reference = createFrozenCredentialRegistryReference(registryAddress, {
      registryId,
      issuerId,
      credentialEpoch: 7n,
      currentRoot: { field: 99n },
      frozenRoot: { field: 99n },
      frozen: true,
      credentialCount: 1n,
    });
    const binding = {
      registryId,
      issuerId,
      credentialEpoch: 7n,
      initialCredentialRoot: { field: 99n },
      registryContractBinding: deriveRegistryContractBinding(registryAddress),
    };
    expect(() => assertReferendumRegistryBinding(reference, binding)).not.toThrow();
    expect(() =>
      assertReferendumRegistryBinding(reference, {
        ...binding,
        initialCredentialRoot: { field: 100n },
      }),
    ).toThrow('canonical frozen registry root');
    expect(() =>
      createFrozenCredentialRegistryReference(registryAddress, {
        registryId,
        issuerId,
        credentialEpoch: 7n,
        currentRoot: { field: 99n },
        frozenRoot: { field: 99n },
        frozen: false,
        credentialCount: 1n,
      }),
    ).toThrow('canonically frozen');
    expect(() =>
      createFrozenCredentialRegistryReference(registryAddress, {
        registryId,
        issuerId,
        credentialEpoch: 7n,
        currentRoot: { field: 100n },
        frozenRoot: { field: 99n },
        frozen: true,
        credentialCount: 1n,
      }),
    ).toThrow('current canonical root');
  });

  describe('a consultation on a registry that keeps enrolling', () => {
    const registryAddress = 'ab'.repeat(32);
    const registryId = new Uint8Array(32).fill(1);
    const issuerId = new Uint8Array(32).fill(2);
    const catalogRegistry = {
      registryContractAddress: registryAddress,
      registryContractBinding: deriveRegistryContractBinding(registryAddress),
      registryId,
      issuerId,
      credentialEpoch: 7n,
      // The root the consultation was deployed against, from the catalogue.
      frozenRoot: { field: 99n },
    };
    const openRegistry = (currentRoot: bigint): CredentialRegistryV1State => ({
      registryId,
      issuerId,
      credentialEpoch: 7n,
      currentRoot: { field: currentRoot },
      frozenRoot: { field: 0n },
      frozen: false,
      credentialCount: 3n,
    });
    const referendum = (
      accepted: readonly bigint[],
      revoked: readonly bigint[] = [],
    ): ReferendumV2AdmissionState => ({
      registryId,
      issuerId,
      credentialEpoch: 7n,
      initialCredentialRoot: { field: 99n },
      acceptedCredentialRoots: accepted.map((field) => ({ field })),
      revokedCredentialRoots: revoked.map((field) => ({ field })),
      registryContractBinding: deriveRegistryContractBinding(registryAddress),
    });

    it('accepts the registry while it is still at the root the consultation started from', () => {
      expect(() =>
        assertCanonicalReferendumBinding(catalogRegistry, openRegistry(99n), referendum([99n])),
      ).not.toThrow();
    });

    it('accepts a later root once the consultation has admitted it', () => {
      expect(() =>
        assertCanonicalReferendumBinding(
          catalogRegistry,
          openRegistry(120n),
          referendum([99n, 120n]),
        ),
      ).not.toThrow();
    });

    it('stops before a proof is built when the latest passes are not admitted yet', () => {
      expect(() =>
        assertCanonicalReferendumBinding(catalogRegistry, openRegistry(120n), referendum([99n])),
      ).toThrow('has not admitted the latest passes yet');
    });

    it('treats a revoked root as not admitted', () => {
      expect(() =>
        assertCanonicalReferendumBinding(
          catalogRegistry,
          openRegistry(120n),
          referendum([99n, 120n], [120n]),
        ),
      ).toThrow('has not admitted the latest passes yet');
    });

    it('refuses a consultation deployed against another root than the catalogue names', () => {
      expect(() =>
        assertCanonicalReferendumBinding(
          { ...catalogRegistry, frozenRoot: { field: 98n } },
          openRegistry(99n),
          referendum([99n]),
        ),
      ).toThrow('canonical frozen registry root');
    });

    it('refuses a consultation bound to another registry contract', () => {
      expect(() =>
        assertCanonicalReferendumBinding(catalogRegistry, openRegistry(99n), {
          ...referendum([99n]),
          registryContractBinding: deriveRegistryContractBinding('cd'.repeat(32)),
        }),
      ).toThrow('contract binding');
    });

    it('refuses a registry whose issuer is not the one the catalogue names', () => {
      expect(() =>
        assertCanonicalReferendumBinding(
          catalogRegistry,
          { ...openRegistry(99n), issuerId: new Uint8Array(32).fill(9) },
          referendum([99n]),
        ),
      ).toThrow('issuer ID');
    });

    it('still pins a frozen registry by its frozen root', () => {
      const frozen: CredentialRegistryV1State = {
        ...openRegistry(99n),
        frozenRoot: { field: 99n },
        frozen: true,
      };
      expect(() =>
        assertCanonicalReferendumBinding(catalogRegistry, frozen, referendum([99n])),
      ).not.toThrow();
      expect(() =>
        assertCanonicalReferendumBinding(
          catalogRegistry,
          { ...frozen, currentRoot: { field: 100n } },
          referendum([99n]),
        ),
      ).toThrow('current canonical root');
    });

    it('does not build an open reference for a frozen registry', () => {
      expect(() =>
        createOpenCredentialRegistryReference(
          registryAddress,
          { ...openRegistry(99n), frozen: true },
          { field: 99n },
        ),
      ).toThrow('frozen root must be pinned');
    });
  });

  it('cryptographically checks the intended registry contract address binding', () => {
    const registryAddress = 'ab'.repeat(32);
    const reference = createFrozenCredentialRegistryReference(registryAddress, {
      registryId: new Uint8Array(32).fill(1),
      issuerId: new Uint8Array(32).fill(2),
      credentialEpoch: 7n,
      currentRoot: { field: 99n },
      frozenRoot: { field: 99n },
      frozen: true,
      credentialCount: 1n,
    });
    const binding = {
      registryId: reference.registryId,
      issuerId: reference.issuerId,
      credentialEpoch: reference.credentialEpoch,
      initialCredentialRoot: reference.frozenRoot,
      registryContractBinding: reference.registryContractBinding,
    };
    expect(() => assertReferendumRegistryBinding(reference, binding)).not.toThrow();
    expect(() =>
      assertReferendumRegistryBinding(reference, {
        ...binding,
        registryContractBinding: deriveRegistryContractBinding('cd'.repeat(32)),
      }),
    ).toThrow('contract binding');
  });
});
