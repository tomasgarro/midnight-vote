/**
 * Turns what the Preview services answer into verdicts an operator can act on.
 *
 * Pure: it is given observations and returns rows. `check-preview-services.mjs`
 * gathers the observations. Every observation is public; none needs a secret.
 *
 * A verdict is one of:
 *
 * | Verdict | Meaning |
 * | --- | --- |
 * | `ok` | Observed, and as it should be |
 * | `wait` | Not ready yet, and it gets there by itself |
 * | `fail` | Wrong. A person would be stopped. `todo` says what to change |
 * | `unknown` | Could not be observed from here. Nothing is claimed |
 */

const CITIZEN_CIRCUITS = ['castVote', 'revealVote'];

const row = (check, verdict, detail, todo) => ({
  check,
  verdict,
  detail,
  ...(todo ? { todo } : {}),
});

const short = (address) => `${address.slice(0, 8)}…${address.slice(-4)}`;
const missingFrom = (wanted, held) => wanted.filter((item) => !(held ?? []).includes(item));
const listed = (addresses) => addresses.map(short).join(', ');

/** A request that got no HTTP answer at all. */
const unreachable = (observation) => !observation || observation.error !== undefined;

function relayRows(relay, wanted, appOrigin) {
  if (unreachable(relay)) {
    return [
      row(
        'Relay answers',
        'unknown',
        `no answer: ${relay?.error ?? 'not asked'}`,
        'The edge serves this name only once the credential project runs the manifest of this repository. If it does, ask again from another network',
      ),
    ];
  }
  if (relay.status === 403) {
    return [
      row(
        'Relay answers',
        'fail',
        `it refuses the origin ${appOrigin}`,
        `Add ${appOrigin} to RELAYER_ALLOWED_ORIGINS`,
      ),
    ];
  }
  if (relay.status === 502 || relay.status === 504) {
    return [
      row(
        'Relay answers',
        'fail',
        `the edge answers ${relay.status}: the relayer is not listening`,
        'Read its log. "Set RELAYER_SEED…" means a secret is still a placeholder',
      ),
    ];
  }
  const body = relay.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.reasons)) {
    return [row('Relay answers', 'fail', `unexpected answer (${relay.status})`)];
  }
  const rows = [row('Relay answers', 'ok', `HTTP ${relay.status}`)];

  const reasons = body.reasons;
  if (body.ready === true) {
    rows.push(row('Relay can pay', 'ok', 'wallet synchronized, DUST available'));
  } else if (reasons.includes('wallet_starting') || reasons.includes('wallet_syncing')) {
    rows.push(
      row(
        'Relay can pay',
        'wait',
        'its wallet is still reading the chain',
        'Nothing. The first start takes hours; later ones minutes',
      ),
    );
  } else if (reasons.includes('v2_disabled')) {
    rows.push(
      row(
        'Relay can pay',
        'fail',
        'walletless actions are off',
        'Set RELAYER_V2_CAPABILITY_SECRET in the relay project',
      ),
    );
  } else if (reasons.includes('dust_unfunded')) {
    rows.push(
      row(
        'Relay can pay',
        'fail',
        'its wallet holds no DUST',
        'Send NIGHT to the relayer wallet and register it for DUST generation',
      ),
    );
  } else {
    rows.push(
      row('Relay can pay', 'fail', `not ready: ${reasons.join(', ') || 'no reason given'}`),
    );
  }

  if (!body.v2) {
    rows.push(
      row(
        'Relay sponsors the consultations',
        'unknown',
        'this relay does not say what it sponsors',
        'Deploy a relayer image that reports it (0.2.3 or later)',
      ),
    );
  } else {
    const contracts = missingFrom(wanted, body.v2.contracts);
    const circuits = missingFrom(CITIZEN_CIRCUITS, body.v2.circuits);
    rows.push(
      contracts.length > 0
        ? row(
            'Relay sponsors the consultations',
            'fail',
            `not allowed: ${listed(contracts)}`,
            'Add them to RELAYER_V2_ALLOWED_CONTRACTS in the relay project',
          )
        : circuits.length > 0
          ? row(
              'Relay sponsors the consultations',
              'fail',
              `circuit not allowed: ${circuits.join(', ')}`,
              'Set RELAYER_V2_ALLOWED_CIRCUITS to castVote,revealVote',
            )
          : row(
              'Relay sponsors the consultations',
              'ok',
              `${wanted.length} consultation(s), sealing and counting`,
            ),
    );
  }

  rows.push(
    originRow('Relay accepts the app', relay.allowOrigin, appOrigin, 'RELAYER_ALLOWED_ORIGINS'),
  );
  return rows;
}

function originRow(check, allowOrigin, appOrigin, variable) {
  return allowOrigin === appOrigin || allowOrigin === '*'
    ? row(check, 'ok', `allows ${appOrigin}`)
    : row(
        check,
        'fail',
        `does not allow ${appOrigin}${allowOrigin ? ` (allows ${allowOrigin})` : ''}`,
        `Add ${appOrigin} to ${variable}`,
      );
}

function credentialRows(cico, wanted, appOrigin) {
  if (unreachable(cico)) {
    return [
      row(
        'Credential service answers',
        'unknown',
        `no answer: ${cico?.error ?? 'not asked'}`,
        'The edge serves this name only once the credential project runs the manifest of this repository. If it does, ask again from another network',
      ),
    ];
  }
  if (cico.status === 502 || cico.status === 504) {
    return [
      row(
        'Credential service answers',
        'wait',
        `the edge answers ${cico.status}: the service is not listening yet`,
        'It listens only once its wallet has read the chain. If hours pass, read its log: a refused secret stops it at start',
      ),
    ];
  }
  if (cico.status === 403) {
    return [
      row(
        'Credential service answers',
        'fail',
        `it refuses the origin ${appOrigin}`,
        `Add ${appOrigin} to CICO_ALLOWED_ORIGINS`,
      ),
    ];
  }
  if (cico.status === 404) {
    return [
      row(
        'Credential service answers',
        'fail',
        'it runs an image without the status route',
        'Deploy the credential manifest of this repository (image 0.2.3 or later)',
      ),
    ];
  }
  const body = cico.body;
  if (cico.status !== 200 || !body || typeof body !== 'object') {
    return [row('Credential service answers', 'fail', `unexpected answer (${cico.status})`)];
  }
  const rows = [row('Credential service answers', 'ok', 'HTTP 200')];

  const unpublished = missingFrom(wanted, body.consultations);
  rows.push(
    unpublished.length > 0
      ? row(
          'New passes are admitted to the consultations',
          'fail',
          `no root publisher for: ${listed(unpublished)}`,
          'Set CICO_REFERENDA_JSON as printed by print-consultation-values.mjs',
        )
      : row(
          'New passes are admitted to the consultations',
          'ok',
          `root publisher configured for ${wanted.length} consultation(s)`,
        ),
  );

  const capabilities = body.actionCapabilities;
  if (!capabilities) {
    rows.push(
      row(
        'Answers without a wallet',
        'fail',
        'the service signs no capability',
        'Set CICO_ACTION_CAPABILITY_SECRET and the three CICO_ACTION_ALLOWED_* values',
      ),
    );
  } else {
    const contracts = missingFrom(wanted, capabilities.contracts);
    const circuits = missingFrom(CITIZEN_CIRCUITS, capabilities.circuits);
    rows.push(
      contracts.length > 0
        ? row(
            'Answers without a wallet',
            'fail',
            `no capability for: ${listed(contracts)}`,
            'Add them to CICO_ACTION_ALLOWED_CONTRACTS',
          )
        : circuits.length > 0
          ? row(
              'Answers without a wallet',
              'fail',
              `circuit not allowed: ${circuits.join(', ')}`,
              'Set CICO_ACTION_ALLOWED_CIRCUITS to castVote,revealVote',
            )
          : row('Answers without a wallet', 'ok', 'capabilities for sealing and counting'),
    );
  }

  const wallet = body.issuerWallet ?? {};
  rows.push(
    wallet.dustAvailable === true
      ? row('Credential service can pay', 'ok', 'its wallet holds DUST')
      : wallet.dustAvailable === false
        ? row(
            'Credential service can pay',
            'fail',
            `its wallet holds no DUST${wallet.address ? ` (${wallet.address})` : ''}`,
            'Send NIGHT to that address and register it for DUST generation: runbook, "If the issuer wallet holds no DUST"',
          )
        : row('Credential service can pay', 'unknown', 'its wallet did not answer'),
  );

  rows.push(
    originRow(
      'Credential service accepts the app',
      cico.allowOrigin,
      appOrigin,
      'CICO_ALLOWED_ORIGINS',
    ),
  );
  return rows;
}

/**
 * A document gets one holder: the service ties every pass of one document to
 * the device that got the first. That works only when the app and the service
 * ask for verifications under the same event, which both derive from the
 * registry. `expectedEventId` is what the app derives.
 */
function documentRow(cico, expectedEventId) {
  const check = 'One pass per document';
  if (unreachable(cico) || cico.status !== 200 || !cico.body || typeof cico.body !== 'object') {
    return row(check, 'unknown', 'the credential service did not answer');
  }
  const rule = cico.body.documents;
  if (!rule) {
    return row(
      check,
      'unknown',
      'this image does not say how it treats a document verified twice',
      'Deploy the credential manifest of this repository (image 0.2.4 or later). Before it, a person verified on two devices holds two passes',
    );
  }
  if (rule.onePassPerDocument === 'off') {
    return row(check, 'ok', 'off by configuration: nothing ties two passes of one document');
  }
  if (expectedEventId && rule.eventId !== expectedEventId) {
    return row(
      check,
      'fail',
      'the service and the app derive different events: it refuses every verification the app asks for',
      'CICO_REGISTRY_CONTRACT_ADDRESS and CICO_CREDENTIAL_EPOCH must be those of the registry manifest the app was built from',
    );
  }
  return rule.onePassPerDocument === 'enforce'
    ? row(check, 'ok', 'a document has one holder; a second device is refused')
    : row(check, 'ok', 'observed only: a second device is logged, not refused');
}

function sharedSecretRow(relay, cico) {
  const relayId = relay?.body?.v2?.capabilityKeyId;
  const cicoId = cico?.body?.actionCapabilities?.keyId;
  if (!relayId || !cicoId) {
    return row(
      'Relay and credential service share one secret',
      'unknown',
      'one of them did not publish its fingerprint',
    );
  }
  return relayId === cicoId
    ? row('Relay and credential service share one secret', 'ok', `fingerprint ${relayId}`)
    : row(
        'Relay and credential service share one secret',
        'fail',
        `fingerprints differ: relay ${relayId}, credential service ${cicoId}`,
        'Paste the same value into RELAYER_V2_CAPABILITY_SECRET and CICO_ACTION_CAPABILITY_SECRET. As it is, the relay refuses every answer after the proof was built',
      );
}

function chainRows(chain) {
  if (unreachable(chain)) {
    return [row('Consultations on chain', 'unknown', `indexer: ${chain?.error ?? 'not asked'}`)];
  }
  return chain.consultations.map((item) => {
    const check = `On chain: ${item.slug}`;
    if (item.missing) {
      return row(check, 'fail', `no contract at ${short(item.contractAddress)}`);
    }
    if (item.phase !== 'COMMIT' || item.closed) {
      return row(check, 'ok', `answers are over (${item.phase.toLowerCase()})`);
    }
    if (item.currentRootAdmitted) {
      return row(
        check,
        'ok',
        `open, ${item.sealedAnswers} sealed, admits every pass issued so far`,
      );
    }
    return item.enrollmentOpen
      ? row(
          check,
          'wait',
          `open, ${item.sealedAnswers} sealed; the newest passes are not admitted yet`,
          'The credential service publishes the root within minutes. If it stays: read its log',
        )
      : row(
          check,
          'ok',
          `open, ${item.sealedAnswers} sealed; admits no more passes, earlier ones can answer`,
        );
  });
}

function siteRows(app, assistant) {
  const rows = [];
  if (unreachable(app)) {
    rows.push(
      row(
        'App is published',
        'unknown',
        `no answer from here: ${app?.error ?? 'not asked'}`,
        'The web host drops some networks. Open the app on a phone with mobile data',
      ),
    );
  } else if (app.status !== 200) {
    rows.push(row('App is published', 'fail', `HTTP ${app.status}`));
  } else {
    const missing = (app.assets ?? []).filter((asset) => asset.status !== 200);
    rows.push(
      missing.length > 0
        ? row(
            'App is published',
            'fail',
            `missing: ${missing.map((asset) => asset.path).join(', ')}`,
            'Publish the whole build folder. Without these a device cannot build a proof',
          )
        : row('App is published', 'ok', 'the page and the proving files answer'),
    );
  }
  if (unreachable(assistant)) {
    rows.push(
      row(
        'Cleisthenes answers',
        'unknown',
        `no answer from here: ${assistant?.error ?? 'not asked'}`,
      ),
    );
  } else {
    rows.push(
      assistant.status === 200
        ? row('Cleisthenes answers', 'ok', 'HTTP 200')
        : row(
            'Cleisthenes answers',
            'fail',
            `HTTP ${assistant.status}`,
            'Restart the project swiss-civic-pilot: it lost the edge network',
          ),
    );
  }
  return rows;
}

/**
 * @param {object} observations
 * @param {{slug: string, contractAddress: string}[]} observations.consultations Live consultations people answer.
 * @param {string} observations.appOrigin
 */
export function evaluatePreviewServices(observations) {
  const wanted = observations.consultations.map((item) => item.contractAddress);
  return [
    ...relayRows(observations.relay, wanted, observations.appOrigin),
    ...credentialRows(observations.cico, wanted, observations.appOrigin),
    documentRow(observations.cico, observations.chain?.documentEventId),
    sharedSecretRow(observations.relay, observations.cico),
    ...chainRows(observations.chain),
    ...siteRows(observations.app, observations.assistant),
  ];
}

/** Ready for a person: nothing wrong, nothing pending, nothing unobserved. */
export function summarize(rows) {
  const count = (verdict) => rows.filter((item) => item.verdict === verdict).length;
  const failed = count('fail');
  const waiting = count('wait');
  const unknown = count('unknown');
  return {
    failed,
    waiting,
    unknown,
    ready: failed === 0 && waiting === 0 && unknown === 0,
    line:
      failed > 0
        ? `${failed} thing(s) would stop a person. Fix them before a phone run.`
        : waiting > 0
          ? `Nothing is wrong. ${waiting} thing(s) are not ready yet.`
          : unknown > 0
            ? `Nothing observed is wrong. ${unknown} thing(s) could not be observed from here.`
            : 'Everything a person needs answered as it should.',
  };
}
