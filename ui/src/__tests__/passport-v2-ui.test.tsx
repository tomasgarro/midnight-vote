import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CanonicalReceipt,
  CivicActionPort,
  CivicCredentialPort,
  CredentialSummary,
  PassportSessionPort,
} from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import { EnrollmentHandoff } from '../components/passport-v2/EnrollmentHandoff';
import { EnrollmentQr } from '../components/passport-v2/EnrollmentQr';
import { PassportJourney } from '../components/passport-v2/PassportJourney';
import { catalogEligibility, toPassportV2Catalog } from '../integration/passport-v2-catalog';

const session = {
  sessionId: 'catalog-session',
  origin: 'http://localhost:3000',
  network: 'preview' as const,
  status: 'connected' as const,
  profile: { displayName: 'Ana' },
  capabilities: ['session', 'profile'] as const,
};

const receipt: CanonicalReceipt = {
  status: 'confirmed',
  action: 'vote',
  network: 'preview',
  transactionId: 'catalog-tx',
  transactionHash: 'catalog-hash',
  contractAddress: 'ab'.repeat(32),
  circuit: 'castVote',
  blockHeight: 1,
  blockHash: 'catalog-block',
  blockTimestamp: '2026-08-24T12:00:00.000Z',
};

const credentialSummary: CredentialSummary = {
  provider: 'rarimo',
  status: 'issued',
  issuerId: 'issuer',
  country: '032' as CredentialSummary['country'],
  ageClass: '18-plus',
  assurance: 'document-nfc',
  credentialEpoch: 7,
  validFrom: '2026-08-24T12:00:00.000Z',
  validUntil: '2026-08-25T12:00:00.000Z',
};

const registry = {
  registryContractAddress: 'registry-contract',
  registryId: new Uint8Array(32).fill(1),
  issuerId: new Uint8Array(32).fill(2),
  credentialEpoch: 7n,
  frozenRoot: { field: 77n },
};

function ports(requests: Array<{ referendumId: string }>) {
  const passport: PassportSessionPort = {
    adapterName: 'test-passport',
    supportedCapabilities: ['session', 'profile'],
    connect: vi.fn().mockResolvedValue(session),
    getSession: vi.fn().mockResolvedValue(session),
    requestCapability: vi.fn(),
    disconnect: vi.fn(),
  };
  const credential: CivicCredentialPort = {
    adapterName: 'test-credential',
    beginEnrollment: vi.fn().mockResolvedValue({
      enrollmentId: 'catalog-enrollment',
      status: 'issued',
      holderBinding: new Uint8Array(32),
      createdAt: '2026-08-24T12:00:00.000Z',
      expiresAt: '2026-08-24T12:10:00.000Z',
    }),
    getEnrollmentStatus: vi.fn(),
    getCredentialSummary: vi.fn().mockResolvedValue(credentialSummary),
    getActionAuthorization: vi
      .fn()
      .mockResolvedValue({ kind: 'civic-credential', handle: 'opaque' }),
    clearCredential: vi.fn(),
  };
  const actions: CivicActionPort = {
    adapterName: 'test-actions',
    castVote: vi.fn(async (request) => {
      requests.push({ referendumId: request.referendumId });
      return receipt;
    }),
    revealVote: vi.fn(),
    recordPublicCohort: vi.fn(),
    getCanonicalReceipt: vi.fn().mockResolvedValue(receipt),
  };
  return { passport, credential, actions };
}

describe('Passport v2 catalog and cross-device handoff', () => {
  it('renders an actual QR matrix plus copy/open fallbacks', async () => {
    const uri = 'https://app.rarime.com/external?id=qr-test';
    render(<EnrollmentQr value={uri} />);
    expect(
      screen
        .getByRole('img', { name: 'Código QR de verificación' })
        .querySelector('path')
        ?.getAttribute('d'),
    ).toMatch(/^M/);

    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<EnrollmentHandoff expiresAt="2026-08-24T12:10:00.000Z" uri={uri} />);
    expect(screen.getByText(/En desktop, escaneá/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir enlace/i }).getAttribute('href')).toBe(uri);
    await user.click(screen.getByRole('button', { name: /Copiar enlace/i }));
    expect(writeText).toHaveBeenCalledWith(uri);
    expect(screen.getByRole('button', { name: /Enlace copiado/i })).toBeTruthy();
  });

  it('keeps referendum configuration out of credential onboarding', async () => {
    const requests: Array<{ referendumId: string }> = [];
    const runtimeEntry = {
      referendumId: 'budget-2030:country',
      contractAddress: 'referendum-contract',
      title: 'Presupuesto 2030',
      question: '¿Aprobás el marco de presupuesto 2030?',
      description: 'Consulta configurada en Preview',
      config: {
        registry,
        countryPolicyEnabled: true,
        countryPolicy: new Uint8Array([...new TextEncoder().encode('032'), ...new Uint8Array(29)]),
        minimumAssurance: 2n,
        requireAdult: true,
        validityReference: 1_787_572_800n,
      },
    } as never;
    const user = userEvent.setup();
    const onCredentialReady = vi.fn();
    render(
      <PassportJourney
        initialLocale="es"
        initialStage="passport"
        mode="preview"
        onClose={vi.fn()}
        onCredentialReady={onCredentialReady}
        previewPorts={{ ...ports(requests), referenda: [runtimeEntry] }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Conectar Midnight Passport/i }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: /Iniciar verificación documental/i }));
    expect(await screen.findByRole('heading', { name: 'Tu credencial está lista' })).toBeTruthy();
    expect(screen.queryByText('Presupuesto 2030')).toBeNull();
    expect(screen.queryByText(/Elegí una consulta|Probar y enviar|política de país/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Ir al panel cívico/i }));
    expect(onCredentialReady).toHaveBeenCalledWith(expect.objectContaining({ country: 'AR' }));
    expect(requests).toEqual([]);
  });

  it('derives global and country scopes from the configured policy', () => {
    const [global, country] = toPassportV2Catalog([
      {
        referendumId: 'global',
        title: 'G',
        question: 'Q',
        config: { countryPolicyEnabled: false },
      } as never,
      {
        referendumId: 'country',
        title: 'C',
        question: 'Q',
        config: { countryPolicyEnabled: true },
      } as never,
    ]);
    expect(global?.scope).toBe('global');
    expect(country?.scope).toBe('country');
  });

  it('blocks an Argentina credential from an Italy-scoped referendum without disclosing the policy', () => {
    const italyPolicy = new Uint8Array([...new TextEncoder().encode('380'), ...new Uint8Array(29)]);
    const [italy] = toPassportV2Catalog([
      {
        referendumId: 'italy-only',
        title: 'Italy only',
        question: 'Q',
        config: {
          registry,
          countryPolicyEnabled: true,
          countryPolicy: italyPolicy,
          minimumAssurance: 2n,
          requireAdult: true,
          validityReference: 1_787_572_800n,
        },
      } as never,
    ]);
    if (!italy) throw new Error('expected Italy catalog entry');
    const eligibility = catalogEligibility(italy, credentialSummary);
    expect(eligibility.available).toBe(false);
    expect(eligibility.reason).not.toContain('380');
  });

  it('routes credentials from another epoch away before vote submission', () => {
    const [item] = toPassportV2Catalog([
      {
        referendumId: 'frozen-epoch-7',
        title: 'Epoch 7',
        question: 'Q',
        config: {
          registry,
          countryPolicyEnabled: false,
          countryPolicy: new Uint8Array(32),
          minimumAssurance: 2n,
          requireAdult: true,
          validityReference: 1_787_572_800n,
        },
      } as never,
    ]);
    if (!item) throw new Error('expected catalog item');

    const eligibility = catalogEligibility(item, { ...credentialSummary, credentialEpoch: 8 });
    expect(eligibility.available).toBe(false);
    expect(eligibility.reason).toMatch(/cohorte anterior|propio epoch/i);
  });

  it('fails closed on assurance, adulthood, and validity policy mismatches', () => {
    const [item] = toPassportV2Catalog([
      {
        referendumId: 'strict-policy',
        title: 'Strict',
        question: 'Q',
        config: {
          registry,
          countryPolicyEnabled: false,
          countryPolicy: new Uint8Array(32),
          minimumAssurance: 2n,
          requireAdult: true,
          validityReference: 1_787_659_200n,
        },
      } as never,
    ]);
    if (!item) throw new Error('expected catalog item');

    expect(
      catalogEligibility(item, { ...credentialSummary, assurance: 'document' }).available,
    ).toBe(false);
    expect(catalogEligibility(item, { ...credentialSummary, ageClass: 'under-18' }).available).toBe(
      false,
    );
    expect(
      catalogEligibility(item, {
        ...credentialSummary,
        validUntil: '2026-08-24T12:00:00.000Z',
      }).available,
    ).toBe(false);
  });
});
