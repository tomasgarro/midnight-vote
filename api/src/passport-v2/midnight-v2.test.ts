import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { Choice } from '../generated/referendum-v2/index.js';
import { deriveRegistryContractBinding } from './crypto.js';
import {
  assertCanonicalReferendumBinding,
  assertReferendumRegistryBinding,
  type CredentialRegistryV1State,
  type CredentialTreeView,
  choiceToGenerated,
  createCompiledCredentialRegistryV1,
  createCompiledReferendumV2,
  createFrozenCredentialRegistryReference,
  createOpenCredentialRegistryReference,
  type ReferendumV2AdmissionState,
  resolveAdmittedCredentialPath,
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

    it('leaves the choice of root to the path lookup: a newer registry root is no refusal', () => {
      expect(() =>
        assertCanonicalReferendumBinding(catalogRegistry, openRegistry(120n), referendum([99n])),
      ).not.toThrow();
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

  describe('the root a pass is proven against', () => {
    const leaf = new Uint8Array(32).fill(7);
    const pathAt = (root: bigint) =>
      ({ provenAgainst: root }) as unknown as MerkleTreePath<Uint8Array>;
    // A registry state that holds the pass, or one from before it was added.
    const tree = (root: bigint, holdsPass = true): CredentialTreeView => ({
      root: { field: root },
      findPath: (candidate) => (holdsPass && candidate === leaf ? pathAt(root) : undefined),
    });
    const consultation = (
      accepted: readonly bigint[],
      options: { revoked?: readonly bigint[]; enrollmentClosed?: boolean } = {},
    ) => ({
      acceptedCredentialRoots: accepted.map((field) => ({ field })),
      revokedCredentialRoots: (options.revoked ?? []).map((field) => ({ field })),
      enrollmentClosed: options.enrollmentClosed ?? false,
    });
    const earlier = (...views: CredentialTreeView[]) => {
      const read: bigint[] = [];
      return {
        read,
        states: async function* () {
          for (const view of views) {
            read.push(view.root.field);
            yield view;
          }
        },
      };
    };

    it('uses the current root when the consultation admits it, and reads no history', async () => {
      const history = earlier(tree(110n));
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(120n),
          frozen: false,
          referendum: consultation([99n, 120n]),
          earlier: history.states,
        }),
      ).resolves.toEqual(pathAt(120n));
      expect(history.read).toEqual([]);
    });

    it('uses the newest admitted earlier root that already held the pass', async () => {
      // Two people got a pass afterwards: 130 and 140 are not admitted yet.
      const history = earlier(tree(140n), tree(130n), tree(120n), tree(110n));
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(140n),
          frozen: false,
          referendum: consultation([99n, 110n, 120n]),
          earlier: history.states,
        }),
      ).resolves.toEqual(pathAt(120n));
      // It stops at the first root that does; 110 is never fetched.
      expect(history.read).toEqual([140n, 130n, 120n]);
    });

    it('refuses, as worth retrying, a pass no admitted root holds yet', async () => {
      // 110 is admitted, and the pass was only added at 120.
      const history = earlier(tree(120n), tree(110n, false), tree(99n, false));
      const attempt = resolveAdmittedCredentialPath({
        credentialLeaf: leaf,
        current: tree(120n),
        frozen: false,
        referendum: consultation([99n, 110n]),
        earlier: history.states,
      });
      await expect(attempt).rejects.toMatchObject({
        code: 'CREDENTIAL_NOT_ADMITTED',
        retryable: true,
      });
      // The tree only grows: once an admitted root lacks the pass, older ones are not read.
      expect(history.read).toEqual([120n, 110n]);
    });

    it('says waiting will not help once the consultation admits no more passes', async () => {
      for (const closed of [
        { referendum: consultation([99n], { enrollmentClosed: true }) },
        { referendum: consultation([99n]), enrollmentDeadlinePassed: true },
      ]) {
        await expect(
          resolveAdmittedCredentialPath({
            credentialLeaf: leaf,
            current: tree(120n),
            frozen: false,
            earlier: earlier(tree(99n, false)).states,
            ...closed,
          }),
        ).rejects.toMatchObject({ code: 'CREDENTIAL_ADMISSION_CLOSED', retryable: false });
      }
    });

    it('still answers a person who enrolled in time after enrolment closed', async () => {
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(140n),
          frozen: false,
          referendum: consultation([99n, 120n], { enrollmentClosed: true }),
          enrollmentDeadlinePassed: true,
          earlier: earlier(tree(130n), tree(120n)).states,
        }),
      ).resolves.toEqual(pathAt(120n));
    });

    it('treats a revoked root as not admitted', async () => {
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(120n),
          frozen: false,
          referendum: consultation([99n, 120n], { revoked: [120n] }),
          earlier: earlier(tree(99n, false)).states,
        }),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_ADMITTED' });
    });

    it('without a history, proves only against the current root', async () => {
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(120n),
          frozen: false,
          referendum: consultation([99n]),
        }),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_ADMITTED', retryable: true });
    });

    it('refuses a pass the registry does not hold, before anything else', async () => {
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(120n, false),
          frozen: false,
          referendum: consultation([120n]),
        }),
      ).rejects.toThrow('not present in the canonical registry');
    });

    it('takes a frozen registry at its one root', async () => {
      await expect(
        resolveAdmittedCredentialPath({
          credentialLeaf: leaf,
          current: tree(99n),
          frozen: true,
          referendum: consultation([99n]),
        }),
      ).resolves.toEqual(pathAt(99n));
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
