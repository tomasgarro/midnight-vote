import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CivicCredentialPort, PassportSessionPort } from 'midnight-referendum-api';
import { isoNumericCountry } from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import { PreviewPassportJourney as PassportJourney } from '../components/passport-v2/PreviewPassportJourney';
import { PASSPORT_ATTEMPT_STORAGE_KEY } from '../integration/passport-enrollment-state';

const session = {
  sessionId: 'passport-session',
  origin: 'http://localhost:3000',
  network: 'preview' as const,
  status: 'connected' as const,
  profile: { displayName: 'Ana Passport' },
  capabilities: ['session', 'profile'] as const,
};

function passportPort(): PassportSessionPort {
  return {
    adapterName: 'test-passport',
    supportedCapabilities: ['session', 'profile'],
    connect: vi.fn().mockResolvedValue(session),
    getSession: vi.fn().mockResolvedValue(session),
    requestCapability: vi.fn(),
    disconnect: vi.fn(),
  };
}

function credentialPort(): CivicCredentialPort {
  return {
    adapterName: 'test-credential',
    beginEnrollment: vi.fn().mockResolvedValue({
      enrollmentId: 'enrollment-id',
      status: 'issued',
      holderBinding: new Uint8Array(32).fill(1),
      createdAt: '2026-08-24T12:00:00.000Z',
      expiresAt: '2026-08-24T12:10:00.000Z',
    }),
    getEnrollmentStatus: vi.fn(),
    getCredentialSummary: vi.fn().mockResolvedValue({
      provider: 'rarimo',
      status: 'issued',
      issuerId: 'cico-preview-issuer',
      country: isoNumericCountry('032'),
      ageClass: '18-plus',
      assurance: 'document-nfc',
      credentialEpoch: 7,
      validFrom: '2026-08-24T12:00:00.000Z',
      validUntil: '2026-08-25T12:00:00.000Z',
    }),
    getActionAuthorization: vi.fn(),
    clearCredential: vi.fn(),
  };
}

describe('Preview Passport journey', () => {
  it('ends at credential success, returns the verified summary, and never opens wallet actions', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCredentialReady = vi.fn();
    const castVote = vi.fn();
    render(
      <PassportJourney
        mode="preview"
        onClose={onClose}
        onCredentialReady={onCredentialReady}
        ports={{
          passport: passportPort(),
          credential: credentialPort(),
          actions: {
            adapterName: 'unused-actions',
            castVote,
            revealVote: vi.fn(),
            recordPublicCohort: vi.fn(),
            getCanonicalReceipt: vi.fn(),
          },
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Conectar Passport/i }));
    expect(
      await screen.findByRole('heading', { name: /Tu pasaporte\.\s*Solo lo esencial\./ }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Iniciar verificación documental/i }));
    expect(await screen.findByRole('heading', { name: 'Tu credencial está lista' })).toBeTruthy();
    expect(screen.getByText('AR')).toBeTruthy();
    expect(screen.queryByText(/Elegir alcance|Probar y enviar|Paso 5|Paso 6|Paso 7/)).toBeNull();
    expect(castVote).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Ir al panel cívico/i }));
    expect(onCredentialReady).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'verified-credential',
        country: 'AR',
        ageClass: '18+',
        assurance: 'document-nfc',
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('connects Passport but does not fabricate a credential when backend ports are absent', async () => {
    const user = userEvent.setup();
    render(
      <PassportJourney mode="preview" onClose={vi.fn()} ports={{ passport: passportPort() }} />,
    );

    await user.click(screen.getByRole('button', { name: /Conectar Passport/i }));
    expect(await screen.findByText(/gateway de evidencia/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Iniciar verificación documental/i })).toBeNull();
  });

  it('shows a pending handoff, expiry, and explicit restart path', async () => {
    const user = userEvent.setup();
    const clearCredential = vi.fn();
    const credential: CivicCredentialPort = {
      ...credentialPort(),
      beginEnrollment: vi.fn().mockResolvedValue({
        enrollmentId: 'pending-enrollment',
        status: 'pending',
        holderBinding: new Uint8Array(32).fill(1),
        createdAt: new Date().toISOString(),
        // A live link: the clock alone must not report it as expired, or the
        // pending state under test is never reachable.
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        interaction: {
          kind: 'cross-device-qr',
          uri: 'https://app.rarime.com/external?id=pending-enrollment',
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      }),
      getEnrollmentStatus: vi.fn().mockResolvedValue({
        enrollmentId: 'pending-enrollment',
        status: 'expired',
        updatedAt: '2026-08-24T12:11:00.000Z',
        errorCode: 'ENROLLMENT_EXPIRED',
      }),
      clearCredential,
    };
    render(
      <PassportJourney
        mode="preview"
        onClose={vi.fn()}
        ports={{ passport: passportPort(), credential }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Conectar Passport/i }));
    await user.click(screen.getByRole('button', { name: /Iniciar verificación documental/i }));
    // Provider enum values are translated before a citizen sees them.
    expect(await screen.findByText('esperando al proveedor')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Código QR de verificación' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Comprobar ahora/i }));
    expect(await screen.findByText('el enlace venció')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Generar un enlace nuevo/i }));
    expect(
      await screen.findByRole('heading', { name: /Tu pasaporte\.\s*Solo lo esencial\./ }),
    ).toBeTruthy();
    expect(clearCredential).toHaveBeenCalledOnce();
  });

  it('says in plain words that the document already has a pass on another device', async () => {
    const user = userEvent.setup();
    const credential: CivicCredentialPort = {
      ...credentialPort(),
      beginEnrollment: vi.fn().mockResolvedValue({
        enrollmentId: 'second-device-enrollment',
        status: 'pending',
        holderBinding: new Uint8Array(32).fill(2),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        interaction: {
          kind: 'cross-device-qr',
          uri: 'https://app.rarime.com/external?id=second-device-enrollment',
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      }),
      getEnrollmentStatus: vi.fn().mockResolvedValue({
        enrollmentId: 'second-device-enrollment',
        status: 'failed',
        updatedAt: new Date().toISOString(),
        errorCode: 'DOCUMENT_ALREADY_ENROLLED',
      }),
    };
    render(
      <PassportJourney
        mode="preview"
        onClose={vi.fn()}
        ports={{ passport: passportPort(), credential }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Conectar Passport/i }));
    await user.click(screen.getByRole('button', { name: /Iniciar verificación documental/i }));
    await user.click(await screen.findByRole('button', { name: /Comprobar ahora/i }));

    // What happened and what to do, not the name of a state.
    expect(
      await screen.findByText(/Este documento ya tiene un pase en otro dispositivo o navegador/),
    ).toBeTruthy();
    expect(screen.getByText(/usá el dispositivo donde lo verificaste primero/)).toBeTruthy();
    expect(screen.queryByText(/terminó con estado/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tu credencial está lista' })).toBeNull();
  });

  it('resumes the scan that was under way when the page was dropped, instead of starting another', async () => {
    const user = userEvent.setup();
    // What a reload leaves in the tab: the attempt's handle and its expiry.
    window.sessionStorage.setItem(
      PASSPORT_ATTEMPT_STORAGE_KEY,
      JSON.stringify({
        enrollmentId: 'kept-enrollment',
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      }),
    );
    const beginEnrollment = vi.fn();
    const getEnrollmentStatus = vi.fn().mockResolvedValue({
      enrollmentId: 'kept-enrollment',
      status: 'issued',
      updatedAt: new Date().toISOString(),
    });
    const onCredentialReady = vi.fn();
    try {
      render(
        <PassportJourney
          mode="preview"
          onClose={vi.fn()}
          onCredentialReady={onCredentialReady}
          initialSession={session}
          ports={{
            passport: passportPort(),
            credential: { ...credentialPort(), beginEnrollment, getEnrollmentStatus },
          }}
        />,
      );

      // The journey goes straight to the attempt. The person did not scan again.
      expect(await screen.findByText('esperando al proveedor')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Comprobar ahora/i }));
      expect(await screen.findByRole('heading', { name: 'Tu credencial está lista' })).toBeTruthy();
      expect(getEnrollmentStatus).toHaveBeenCalledWith('kept-enrollment');
      expect(beginEnrollment).not.toHaveBeenCalled();
      // Once the pass exists, the handle has no further use.
      expect(window.sessionStorage.getItem(PASSPORT_ATTEMPT_STORAGE_KEY)).toBeNull();
    } finally {
      window.sessionStorage.removeItem(PASSPORT_ATTEMPT_STORAGE_KEY);
    }
  });
});
