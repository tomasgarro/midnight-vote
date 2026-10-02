import { describe, expect, it } from 'vitest';
import { evaluatePreviewServices, summarize } from './preview-checks.mjs';

const consultation = 'ab'.repeat(32);
const other = 'cd'.repeat(32);
const appOrigin = 'https://midnight.vote';

/** Everything as it should be. Each test breaks one thing. */
function healthy() {
  return {
    consultations: [{ slug: 'test', contractAddress: consultation }],
    appOrigin,
    relay: {
      status: 200,
      allowOrigin: appOrigin,
      body: {
        ready: true,
        reasons: [],
        v2: {
          capabilityKeyId: '4caad0fe941626a4',
          networks: ['preview'],
          contracts: [consultation],
          circuits: ['castVote', 'revealVote'],
        },
      },
    },
    cico: {
      status: 200,
      allowOrigin: appOrigin,
      body: {
        registryContractAddress: 'ef'.repeat(32),
        consultations: [consultation],
        actionCapabilities: {
          keyId: '4caad0fe941626a4',
          networks: ['preview'],
          contracts: [consultation],
          circuits: ['castVote', 'revealVote'],
        },
        issuerWallet: { address: 'mn_addr_preview1issuer', dustAvailable: true },
      },
    },
    chain: {
      consultations: [
        {
          slug: 'test',
          contractAddress: consultation,
          phase: 'COMMIT',
          closed: false,
          sealedAnswers: '3',
          enrollmentOpen: true,
          currentRootAdmitted: true,
        },
      ],
    },
    app: { status: 200, assets: [{ path: '/zk-params/bls_midnight_2p15', status: 200 }] },
    assistant: { status: 200 },
  };
}

const verdictOf = (rows, check) => rows.find((row) => row.check === check);
const evaluate = (change) => {
  const observations = healthy();
  change(observations);
  return evaluatePreviewServices(observations);
};

describe('what the Preview services say about a person being able to answer', () => {
  it('finds nothing to do when everything answers as it should', () => {
    const rows = evaluatePreviewServices(healthy());
    expect(rows.every((row) => row.verdict === 'ok')).toBe(true);
    expect(rows.some((row) => row.todo)).toBe(false);
    expect(summarize(rows)).toMatchObject({ ready: true, failed: 0, waiting: 0, unknown: 0 });
  });

  it('tells a relay that is still starting from one that is wrong', () => {
    const syncing = evaluate((o) => {
      o.relay.status = 503;
      o.relay.body = { ...o.relay.body, ready: false, reasons: ['wallet_syncing'] };
    });
    expect(verdictOf(syncing, 'Relay can pay')).toMatchObject({ verdict: 'wait' });
    expect(summarize(syncing)).toMatchObject({ ready: false, failed: 0, waiting: 1 });

    const unfunded = evaluate((o) => {
      o.relay.status = 503;
      o.relay.body = { ...o.relay.body, ready: false, reasons: ['dust_unfunded'] };
    });
    expect(verdictOf(unfunded, 'Relay can pay')).toMatchObject({ verdict: 'fail' });

    const placeholder = evaluate((o) => {
      o.relay = { status: 502, body: null, allowOrigin: null };
    });
    expect(verdictOf(placeholder, 'Relay answers')).toMatchObject({ verdict: 'fail' });
    expect(verdictOf(placeholder, 'Relay answers').todo).toContain('RELAYER_SEED');

    const refused = evaluate((o) => {
      o.relay = { status: 403, body: { error: 'origin_not_allowed' }, allowOrigin: null };
    });
    expect(verdictOf(refused, 'Relay answers').todo).toContain('RELAYER_ALLOWED_ORIGINS');
  });

  it('catches the two pastes of the shared secret not being the same value', () => {
    const rows = evaluate((o) => {
      o.cico.body.actionCapabilities.keyId = '0000000000000000';
    });
    const row = verdictOf(rows, 'Relay and credential service share one secret');
    expect(row.verdict).toBe('fail');
    expect(row.todo).toContain('RELAYER_V2_CAPABILITY_SECRET');
    expect(row.todo).toContain('CICO_ACTION_CAPABILITY_SECRET');
    expect(summarize(rows).failed).toBe(1);
  });

  it('claims nothing about the shared secret when a fingerprint is missing', () => {
    const rows = evaluate((o) => {
      delete o.relay.body.v2;
    });
    expect(verdictOf(rows, 'Relay and credential service share one secret').verdict).toBe(
      'unknown',
    );
    expect(verdictOf(rows, 'Relay sponsors the consultations').verdict).toBe('unknown');
  });

  it('names a consultation a service was not told about, and the variable to change', () => {
    const rows = evaluate((o) => {
      o.consultations.push({ slug: 'second', contractAddress: other });
      o.chain.consultations.push({
        ...o.chain.consultations[0],
        slug: 'second',
        contractAddress: other,
      });
    });
    expect(verdictOf(rows, 'Relay sponsors the consultations')).toMatchObject({
      verdict: 'fail',
      todo: 'Add them to RELAYER_V2_ALLOWED_CONTRACTS in the relay project',
    });
    expect(verdictOf(rows, 'New passes are admitted to the consultations').todo).toContain(
      'CICO_REFERENDA_JSON',
    );
    expect(verdictOf(rows, 'Answers without a wallet').todo).toContain(
      'CICO_ACTION_ALLOWED_CONTRACTS',
    );
    expect(verdictOf(rows, 'Relay sponsors the consultations').detail).toContain('cdcdcdcd…cdcd');
  });

  it('requires counting as well as sealing', () => {
    const rows = evaluate((o) => {
      o.relay.body.v2.circuits = ['castVote'];
      o.cico.body.actionCapabilities.circuits = ['castVote'];
    });
    expect(verdictOf(rows, 'Relay sponsors the consultations').detail).toContain('revealVote');
    expect(verdictOf(rows, 'Answers without a wallet').detail).toContain('revealVote');
  });

  it('reads the credential service: listening, refused origin, old image, empty wallet', () => {
    const replaying = evaluate((o) => {
      o.cico = { status: 502, body: null, allowOrigin: null };
    });
    expect(verdictOf(replaying, 'Credential service answers').verdict).toBe('wait');

    const refused = evaluate((o) => {
      o.cico = { status: 403, body: { message: 'Origin is not allowed' }, allowOrigin: null };
    });
    expect(verdictOf(refused, 'Credential service answers').todo).toContain('CICO_ALLOWED_ORIGINS');

    const old = evaluate((o) => {
      o.cico = { status: 404, body: { message: 'Route not found' }, allowOrigin: appOrigin };
    });
    expect(verdictOf(old, 'Credential service answers').verdict).toBe('fail');

    const empty = evaluate((o) => {
      o.cico.body.issuerWallet.dustAvailable = false;
    });
    const row = verdictOf(empty, 'Credential service can pay');
    expect(row.verdict).toBe('fail');
    expect(row.detail).toContain('mn_addr_preview1issuer');

    const silent = evaluate((o) => {
      o.cico.body.issuerWallet = { address: null, dustAvailable: null };
    });
    expect(verdictOf(silent, 'Credential service can pay').verdict).toBe('unknown');
  });

  it('refuses a service that does not accept the app as an origin', () => {
    const rows = evaluate((o) => {
      o.relay.allowOrigin = 'https://cardanoschool.org';
      o.cico.allowOrigin = null;
    });
    expect(verdictOf(rows, 'Relay accepts the app').todo).toContain('RELAYER_ALLOWED_ORIGINS');
    expect(verdictOf(rows, 'Credential service accepts the app').verdict).toBe('fail');
  });

  it('says where a consultation stands on chain', () => {
    const lagging = evaluate((o) => {
      o.chain.consultations[0].currentRootAdmitted = false;
    });
    expect(verdictOf(lagging, 'On chain: test')).toMatchObject({ verdict: 'wait' });

    // Enrolment over: the newest passes will never be admitted, and that is fine.
    const closedToPasses = evaluate((o) => {
      o.chain.consultations[0].currentRootAdmitted = false;
      o.chain.consultations[0].enrollmentOpen = false;
    });
    expect(verdictOf(closedToPasses, 'On chain: test')).toMatchObject({ verdict: 'ok' });
    expect(verdictOf(closedToPasses, 'On chain: test').detail).toContain('earlier ones can answer');

    const counting = evaluate((o) => {
      o.chain.consultations[0].phase = 'REVEAL';
      o.chain.consultations[0].closed = true;
    });
    expect(verdictOf(counting, 'On chain: test').detail).toContain('answers are over');

    const gone = evaluate((o) => {
      o.chain.consultations[0] = { slug: 'test', contractAddress: consultation, missing: true };
    });
    expect(verdictOf(gone, 'On chain: test').verdict).toBe('fail');
  });

  it('treats what it could not reach as unknown, never as fine and never as broken', () => {
    const rows = evaluate((o) => {
      o.relay = { error: 'ENOTFOUND' };
      o.cico = { error: 'ETIMEDOUT' };
      o.chain = { error: 'indexer unavailable' };
      o.app = { error: 'ECONNRESET' };
      o.assistant = { error: 'ECONNRESET' };
    });
    expect(rows.every((row) => row.verdict === 'unknown')).toBe(true);
    const summary = summarize(rows);
    expect(summary).toMatchObject({ ready: false, failed: 0 });
    expect(summary.line).toContain('could not be observed from here');
  });

  it('notices a published app without its proving files', () => {
    const rows = evaluate((o) => {
      o.app.assets = [
        { path: '/zk-params/bls_midnight_2p15', status: 404 },
        { path: '/managed/referendum-v2/keys/castVote.prover', status: 200 },
      ];
    });
    const row = verdictOf(rows, 'App is published');
    expect(row.verdict).toBe('fail');
    expect(row.detail).toBe('missing: /zk-params/bls_midnight_2p15');
  });

  it('puts a failure before a wait in the last line', () => {
    const rows = evaluate((o) => {
      o.relay.status = 503;
      o.relay.body = { ...o.relay.body, ready: false, reasons: ['wallet_syncing'] };
      o.assistant.status = 502;
    });
    expect(summarize(rows).line).toContain('would stop a person');
  });
});
