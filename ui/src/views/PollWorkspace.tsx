import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Fingerprint,
  LockKey,
  Plus,
  ShieldCheck,
} from '@phosphor-icons/react';
import {
  ballotCommitment,
  createOpening,
  digest,
  exportReceipt,
  importReceipt,
  type PassportVerificationReport,
  PILOT_GATES,
  type PollDraft,
  type PublishedPoll,
  pollPhase,
  publishPoll,
  releaseBlockers,
  VISIBILITY_COPY,
  type Visibility,
  type VoteReceipt,
  verifyReceiptOpening,
} from 'midnight-vote-polls';
import { useEffect, useRef, useState } from 'react';
import {
  MidnightPassportClient,
  type MidnightPassportConnection,
} from '@/integration/midnight-passport-client';
import './poll-workspace.css';

const STORAGE_KEY = 'midnight.vote/restart/demo-polls/v1';
type Tab = 'polls' | 'organizer' | 'verify' | 'connect';
interface DemoBallot {
  pollId: string;
  choice: number;
  receipt: VoteReceipt;
  publicAccount?: string;
}
const tabFromHash = (): Tab =>
  window.location.hash === '#organizer'
    ? 'organizer'
    : window.location.hash === '#verify'
      ? 'verify'
      : window.location.hash === '#connect'
        ? 'connect'
        : 'polls';

function saveFile(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PollWorkspace() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [polls, setPolls] = useState<PublishedPoll[]>([]);
  const [ballots, setBallots] = useState<DemoBallot[]>([]);
  const [connection, setConnection] = useState<MidnightPassportConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [accountVerification, setAccountVerification] = useState<PassportVerificationReport | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<PublishedPoll | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [publicConsent, setPublicConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<VoteReceipt | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState({
    question: '',
    description: '',
    options: 'Yes\nNo\nAbstain',
    visibility: 'anonymous' as Visibility,
    eligibility: 'account',
    credentialValue: '',
    opensAt: '',
    closesAt: '',
  });
  const client = useRef<MidnightPassportClient | null>(null);
  const connectionAttempt = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const passport = new MidnightPassportClient();
    client.current = passport;
    document.title = 'midnight.vote — Connect. Vote. Verify.';
    let active = true;
    const load = async () => {
      try {
        const restored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (Array.isArray(restored) && restored.length < 100) {
          const valid: PublishedPoll[] = [];
          for (const value of restored) {
            if (value?.environment !== 'simulation' || !Number.isSafeInteger(value.publishedAt))
              continue;
            // Recompute the immutable rules digest instead of trusting local JSON.
            const checked = await publishPoll(
              value,
              'simulation',
              Math.min(value.publishedAt, value.closesAt - 1),
            );
            if (checked.rulesHash === value.rulesHash) valid.push(checked);
          }
          if (active && valid.length) {
            setPolls(valid);
            return;
          }
        }
      } catch {
        if (active)
          setNotice(
            'Saved demo polls could not be restored. Your Midnight Passport account is unaffected.',
          );
      }
      const start = Date.now();
      const examples: PollDraft[] = [
        {
          id: 'shared-spaces',
          question: 'What should our community improve next?',
          description:
            'A small decision we can make together. Explore the voting experience with this local demonstration.',
          options: ['A shared library', 'More green spaces', 'Community workshops'],
          visibility: 'anonymous',
          eligibility: { kind: 'midnight-passport-account' },
          opensAt: start - 1000,
          closesAt: start + 7 * 86400_000,
        },
        {
          id: 'shared-budget',
          question: 'How should we use the shared budget?',
          description:
            'A demonstration of private aggregate results. The live cryptographic tally remains gated.',
          options: ['Repair the meeting room', 'Fund a community event', 'Save for next year'],
          visibility: 'private',
          eligibility: { kind: 'midnight-passport-account' },
          opensAt: start - 1000,
          closesAt: start + 7 * 86400_000,
        },
        {
          id: 'open-record',
          question: 'Should our next meeting be hybrid?',
          description:
            'In a public poll, participants consent to publishing their account and choice after closing.',
          options: ['Yes', 'No', 'Abstain'],
          visibility: 'public',
          eligibility: { kind: 'midnight-passport-account' },
          opensAt: start - 1000,
          closesAt: start + 7 * 86400_000,
        },
      ];
      const result = await Promise.all(examples.map((p) => publishPoll(p, 'simulation', start)));
      if (active) setPolls(result);
    };
    void load();
    if (window.location.pathname === '/passport-callback') {
      // StrictMode probes effect cleanup before this microtask. Only the active mount
      // may consume/scrub the one-use redirect and start its server request.
      queueMicrotask(() => {
        if (!active) return;
        try {
          const connected = passport.callback();
          if (connected) {
            setConnection(connected);
            setNotice(
              'Midnight Passport profile connected. Account-control authorization remains unavailable.',
            );
            const attempt = connectionAttempt.current;
            void passport.verifyCallbackOnServer().then(
              (report) => {
                if (active && attempt === connectionAttempt.current && report) {
                  setAccountVerification(report);
                  setNotice(
                    'The server verified the signed response. Account authority remains blocked upstream.',
                  );
                }
              },
              (error) => {
                if (active && attempt === connectionAttempt.current)
                  setNotice(
                    error instanceof Error ? error.message : 'Account verification failed.',
                  );
              },
            );
          }
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : 'Midnight Passport connection failed.',
          );
        }
        window.history.replaceState(null, '', '/#connect');
        setTab('connect');
      });
    }
    const onHash = () => {
      if (window.location.hash === '#poll-main') return;
      setTab(tabFromHash());
      setSelected(null);
      setChoice(null);
      setPublicConsent(false);
    };
    window.addEventListener('hashchange', onHash);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      connectionAttempt.current++;
      passport.cancel();
      clearInterval(timer);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    if (!polls.length) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(polls));
    } catch {
      setNotice(
        'This browser cannot save demo poll definitions. You can still explore this session.',
      );
    }
  }, [polls]);

  const connect = async () => {
    const attempt = ++connectionAttempt.current;
    setConnecting(true);
    setAccountVerification(null);
    setNotice('');
    try {
      const connected = await client.current?.connect();
      if (connected && attempt === connectionAttempt.current) setConnection(connected);
    } catch (error) {
      if (attempt === connectionAttempt.current)
        setNotice(error instanceof Error ? error.message : 'Could not connect Midnight Passport.');
    } finally {
      if (attempt === connectionAttempt.current) setConnecting(false);
    }
  };

  const verifyAccount = async () => {
    if (!connection?.account) return;
    const attempt = ++connectionAttempt.current;
    setConnecting(true);
    setNotice('');
    setAccountVerification(null);
    try {
      await client.current?.verifyAccount(connection.account);
    } catch (error) {
      if (attempt === connectionAttempt.current)
        setNotice(error instanceof Error ? error.message : 'Could not start account verification.');
    } finally {
      if (attempt === connectionAttempt.current) setConnecting(false);
    }
  };

  const simulateVote = async () => {
    if (!selected || choice === null || busy) return;
    setBusy(true);
    setNotice('');
    try {
      if (pollPhase(selected) !== 'open') throw new Error('This poll is not open.');
      if (selected.eligibility.kind !== 'midnight-passport-account')
        throw new Error(
          'A genuine eligibility credential is required. Midnight Passport profile consent does not prove this claim.',
        );
      if (ballots.some((b) => b.pollId === selected.id))
        throw new Error('You already answered this demo poll in this session.');
      if (selected.visibility === 'public' && !publicConsent)
        throw new Error('A public poll requires explicit disclosure consent.');
      const opening = createOpening(selected, choice);
      const saved: VoteReceipt = {
        kind: 'midnight.vote/receipt/v1',
        environment: 'simulation',
        opening,
        commitment: await ballotCommitment(opening),
      };
      setBallots((previous) => [
        ...previous,
        {
          pollId: selected.id,
          choice,
          receipt: saved,
          ...(selected.visibility === 'public' ? { publicAccount: 'Simulated account' } : {}),
        },
      ]);
      setReceipt(saved);
      setNotice(
        'Demo answer saved for this session. No vote or transaction was sent to Midnight. Export an encrypted receipt to keep your choice.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the demo answer.');
    } finally {
      setBusy(false);
    }
  };

  const publishDemo = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const value: PollDraft = {
        id: crypto.randomUUID(),
        question: draft.question,
        description: draft.description,
        options: draft.options.split('\n').filter((s) => s.trim()),
        visibility: draft.visibility,
        eligibility:
          draft.eligibility === 'account'
            ? { kind: 'midnight-passport-account' }
            : {
                kind: 'credential',
                claim: draft.eligibility as 'nationality' | 'age' | 'membership' | 'residence',
                value: draft.credentialValue,
              },
        opensAt: draft.opensAt ? new Date(draft.opensAt).getTime() : Date.now(),
        closesAt: new Date(draft.closesAt).getTime(),
      };
      const published = await publishPoll(value, 'simulation');
      setPolls((previous) => [...previous, published]);
      setNotice(
        'Demo poll published on this device. Its visibility, options, schedule, and eligibility rules are now fixed. Live publishing remains unavailable.',
      );
      setDraft({
        question: '',
        description: '',
        options: 'Yes\nNo\nAbstain',
        visibility: 'anonymous',
        eligibility: 'account',
        credentialValue: '',
        opensAt: '',
        closesAt: '',
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not publish the demo poll.');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!receipt) return;
    setBusy(true);
    setNotice('');
    try {
      saveFile(
        await exportReceipt(receipt, passphrase),
        `${receipt.opening.pollId}.midnight-vote.json`,
      );
      setPassphrase('');
      setNotice(
        'Encrypted receipt exported. Keep its passphrase separately; neither midnight.vote nor Midnight Passport can recover it.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Receipt export failed.');
    } finally {
      setBusy(false);
    }
  };
  const restore = async (file: File) => {
    setBusy(true);
    setNotice('');
    try {
      if (file.size > 2_000_000) throw new Error('Receipt file is too large.');
      const restored = await importReceipt(await file.text(), passphrase);
      setReceipt(restored);
      setPassphrase('');
      const matches = await verifyReceiptOpening(restored);
      setNotice(
        matches
          ? 'Your private opening matches the ballot commitment. Chain confirmation and final-tally inclusion require an independent chain reader and proof; they are not established by this file.'
          : 'Receipt verification failed.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'The receipt could not be decrypted. Check the file and passphrase.',
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="poll-workspace">
      <a className="poll-skip" href="#poll-main">
        Skip to content
      </a>
      <header className="poll-header">
        <a href="/" className="poll-brand">
          <img src="/brand/midnight-vote-d3-black.svg" width="38" height="24" alt="" />
          midnight.vote
        </a>
        <nav aria-label="Poll workspace">
          <a href="#polls" aria-current={tab === 'polls' ? 'page' : undefined}>
            Explore
          </a>
          <a href="#organizer" aria-current={tab === 'organizer' ? 'page' : undefined}>
            Organize
          </a>
          <a href="#verify" aria-current={tab === 'verify' ? 'page' : undefined}>
            Verify
          </a>
        </nav>
        <a className="poll-account" href="#connect">
          <Fingerprint size={18} />
          {connection?.displayName ?? 'Midnight Passport'}
        </a>
      </header>
      <div className="poll-release-note">
        <span>Development preview</span> Official Midnight Passport connector · simulated polls ·
        live voting unavailable
      </div>
      <main id="poll-main" className="poll-main" tabIndex={-1}>
        {notice && (
          <div className="poll-notice" role="status">
            {notice}
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {tab === 'connect' && (
          <>
            <div className="poll-page-intro">
              <p className="poll-kicker">Your account. Your consent.</p>
              <h1>Start with Midnight Passport.</h1>
              <p>
                Create or connect your account in the official Midnight Passport window. You choose
                which profile details to share.
              </p>
            </div>
            <div className="poll-connect-grid">
              <section className="poll-panel poll-connect-card">
                <Fingerprint size={40} weight="thin" />
                <h2>{connection ? 'Your profile is connected.' : 'One familiar way in.'}</h2>
                {connection ? (
                  <>
                    <dl className="poll-facts">
                      <dt>Display name</dt>
                      <dd>{connection.displayName ?? 'Not shared'}</dd>
                      <dt>Account network</dt>
                      <dd>{connection.account?.network ?? 'Account not shared'}</dd>
                      <dt>Account</dt>
                      <dd className="poll-mono">{connection.account?.address ?? 'Not shared'}</dd>
                      <dt>Voting authority</dt>
                      <dd>Unavailable — profile consent is not an account-control proof</dd>
                      <dt>Preview compatibility</dt>
                      <dd>
                        {connection.account?.network === 'stagenet'
                          ? 'Different network — this is a Stagenet account'
                          : 'Preview account authority still needs verification'}
                      </dd>
                    </dl>
                    {connection.account && (
                      <>
                        <button
                          className="poll-primary"
                          type="button"
                          disabled={connecting}
                          onClick={() => void verifyAccount()}
                        >
                          {connecting ? 'Starting verification…' : 'Check account verification'}
                        </button>
                        <p className="poll-small">
                          Checks a fresh signed response on our server. The current Midnight
                          Passport connector cannot yet prove account authority.
                        </p>
                      </>
                    )}
                    {accountVerification && (
                      <div className="poll-verification-report" role="status">
                        <h3>Server verification result</h3>
                        <p>Response signature and fresh request: verified.</p>
                        <p>Account authority: unavailable. Live voting remains blocked.</p>
                        <ul>
                          {accountVerification.blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        connectionAttempt.current++;
                        client.current?.cancel();
                        setConnection(null);
                        setAccountVerification(null);
                        setConnecting(false);
                      }}
                    >
                      Disconnect profile
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      No seed phrase, payment, or physical-passport scan is requested by
                      midnight.vote.
                    </p>
                    <button
                      className="poll-primary"
                      type="button"
                      disabled={connecting}
                      onClick={() => void connect()}
                    >
                      {connecting
                        ? 'Waiting for Midnight Passport…'
                        : 'Create or connect Midnight Passport'}
                      <ArrowUpRight size={18} />
                    </button>
                    {connecting && (
                      <button
                        type="button"
                        onClick={() => {
                          connectionAttempt.current++;
                          client.current?.cancel();
                          setConnecting(false);
                          setNotice('Connection cancelled. No voting permission was granted.');
                        }}
                      >
                        Cancel connection
                      </button>
                    )}
                    <button
                      className="poll-text-button"
                      type="button"
                      onClick={() => {
                        try {
                          client.current?.redirect();
                        } catch (error) {
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : 'Could not start the redirect.',
                          );
                        }
                      }}
                    >
                      Connect using a full-page redirect
                    </button>
                  </>
                )}
                <a href="#polls" className="poll-text-link">
                  Explore the demonstration <ArrowUpRight size={16} />
                </a>
              </section>
              <aside className="poll-panel">
                <h2>Connection and eligibility are separate.</h2>
                <p>
                  A Midnight Passport account is the entry point. Open polls will require proof that
                  you control that account, with one response per account.
                </p>
                <p>
                  Regional rules need an additional verified claim. A physical passport scanned over
                  NFC is a later credential path; it is not Midnight Passport.
                </p>
                <p className="poll-small">
                  Current account network: Stagenet. Voting target: Midnight Preview. A Stagenet
                  profile does not become a Preview account.
                </p>
                <details>
                  <summary>Upstream and midnight.vote work</summary>
                  <ul>
                    {PILOT_GATES.map((gate) => (
                      <li key={gate.id}>
                        <strong>{gate.owner}:</strong> {gate.detail}
                      </li>
                    ))}
                  </ul>
                </details>
              </aside>
            </div>
          </>
        )}
        {tab === 'polls' && (
          <>
            <div className="poll-page-intro">
              <p className="poll-kicker">Small questions. Shared possibilities.</p>
              <h1>A voice in what comes next.</h1>
              <p>
                Connect with Midnight Passport. Check the rules. Vote once. Keep a way to verify.
              </p>
            </div>
            {selected ? (
              <section className="poll-panel poll-ballot">
                <button
                  type="button"
                  className="poll-text-button"
                  onClick={() => {
                    setSelected(null);
                    setChoice(null);
                  }}
                >
                  <ArrowLeft size={16} /> All polls
                </button>
                <div className="poll-card-meta">
                  <span>{VISIBILITY_COPY[selected.visibility].label}</span>
                  <span>Demo</span>
                </div>
                <h2>{selected.question}</h2>
                <p>{selected.description}</p>
                <div className="poll-rule">
                  <LockKey size={19} />
                  <p>
                    {VISIBILITY_COPY[selected.visibility].description}
                    <small>
                      These are the intended live rules. This demonstration sends nothing to the
                      blockchain.
                    </small>
                  </p>
                </div>
                <fieldset
                  disabled={
                    pollPhase(selected, now) !== 'open' ||
                    ballots.some((b) => b.pollId === selected.id) ||
                    selected.eligibility.kind !== 'midnight-passport-account'
                  }
                >
                  <legend>Your answer</legend>
                  {selected.options.map((option, index) => (
                    <label className="poll-option" key={option}>
                      <input
                        type="radio"
                        name="choice"
                        checked={choice === index}
                        onChange={() => setChoice(index)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
                {selected.eligibility.kind !== 'midnight-passport-account' && (
                  <p className="poll-unavailable">
                    Requires verified {selected.eligibility.claim}: {selected.eligibility.value}.
                    This credential is unavailable. Choosing a country or connecting a profile does
                    not grant eligibility.
                  </p>
                )}
                {selected.visibility === 'public' && (
                  <label className="poll-public-consent">
                    <input
                      type="checkbox"
                      checked={publicConsent}
                      onChange={(event) => setPublicConsent(event.target.checked)}
                    />
                    I understand that a public poll publishes the account and its choice after
                    closing. This demonstration uses a simulated account.
                  </label>
                )}
                <button
                  className="poll-primary"
                  type="button"
                  disabled={
                    choice === null ||
                    (selected.visibility === 'public' && !publicConsent) ||
                    busy ||
                    ballots.some((b) => b.pollId === selected.id) ||
                    pollPhase(selected, now) !== 'open' ||
                    selected.eligibility.kind !== 'midnight-passport-account'
                  }
                  onClick={() => void simulateVote()}
                >
                  {ballots.some((b) => b.pollId === selected.id)
                    ? 'Demo answer saved'
                    : 'Save a demo answer'}
                  <Check size={18} />
                </button>
                <p className="poll-small">
                  The live design counts an accepted vote without another visit. Current
                  demonstration answers last for this browser session.
                </p>
                {receipt?.opening.pollId === selected.id && (
                  <a href="#verify" className="poll-text-link">
                    Export and verify your demo receipt <ArrowUpRight size={16} />
                  </a>
                )}
                {pollPhase(selected, now) === 'closed' && (
                  <div className="poll-results">
                    <h3>Local demonstration totals</h3>
                    {selected.options.map((option, index) => (
                      <p key={option}>
                        {option}
                        <strong>
                          {
                            ballots.filter((b) => b.pollId === selected.id && b.choice === index)
                              .length
                          }
                        </strong>
                      </p>
                    ))}
                    <small>Not a blockchain tally or a cryptographic aggregate proof.</small>
                    {selected.visibility !== 'private' && (
                      <>
                        <h3>
                          {selected.visibility === 'public'
                            ? 'Public demonstration answers'
                            : 'Anonymous demonstration answers'}
                        </h3>
                        {ballots
                          .filter((ballot) => ballot.pollId === selected.id)
                          .map((ballot) => (
                            <p key={ballot.receipt.commitment}>
                              {selected.visibility === 'public' ? `${ballot.publicAccount}: ` : ''}
                              {selected.options[ballot.choice]}
                            </p>
                          ))}
                      </>
                    )}
                  </div>
                )}
              </section>
            ) : (
              <div className="poll-grid">
                {polls.map((poll, index) => (
                  <article className="poll-card" key={poll.id}>
                    <div className="poll-card-meta">
                      <span>{VISIBILITY_COPY[poll.visibility].label}</span>
                      <span>{pollPhase(poll, now)}</span>
                    </div>
                    <span className="poll-card-number">{String(index + 1).padStart(2, '0')}</span>
                    <h2>{poll.question}</h2>
                    <p>{poll.description}</p>
                    <div className="poll-card-foot">
                      <span>
                        {poll.eligibility.kind === 'midnight-passport-account'
                          ? 'Midnight Passport account'
                          : `Verified ${poll.eligibility.claim}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(poll);
                          setChoice(null);
                          setPublicConsent(false);
                        }}
                      >
                        Explore demo <ArrowUpRight size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'organizer' && (
          <>
            <div className="poll-page-intro">
              <p className="poll-kicker">For people who bring people together.</p>
              <h1>Make room for a shared decision.</h1>
              <p>Draft a question, choose who can answer, and explain what becomes public.</p>
            </div>
            <div className="poll-organizer-grid">
              <form className="poll-panel poll-form" onSubmit={(event) => void publishDemo(event)}>
                <h2>Create a demonstration poll</h2>
                <p className="poll-small">
                  This local workspace stores poll definitions on this device. It is not an
                  authenticated live organizer account.
                </p>
                <label>
                  Question
                  <input
                    required
                    maxLength={240}
                    value={draft.question}
                    onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                    placeholder="What should we decide together?"
                  />
                </label>
                <label>
                  Context
                  <textarea
                    maxLength={4000}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={3}
                  />
                </label>
                <label>
                  Options — one per line
                  <textarea
                    required
                    value={draft.options}
                    onChange={(e) => setDraft({ ...draft, options: e.target.value })}
                    rows={4}
                  />
                </label>
                <fieldset>
                  <legend>What becomes public after closing?</legend>
                  {(['public', 'anonymous', 'private'] as const).map((mode) => (
                    <label className="poll-visibility-option" key={mode}>
                      <input
                        type="radio"
                        name="visibility"
                        checked={draft.visibility === mode}
                        onChange={() => setDraft({ ...draft, visibility: mode })}
                      />
                      <span>
                        <strong>{VISIBILITY_COPY[mode].label}</strong>
                        <small>{VISIBILITY_COPY[mode].description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label>
                  Who may answer?
                  <select
                    value={draft.eligibility}
                    onChange={(e) => setDraft({ ...draft, eligibility: e.target.value })}
                  >
                    <option value="account">Any proven Midnight Passport account</option>
                    <option value="nationality">Verified nationality</option>
                    <option value="residence">Verified residence</option>
                    <option value="age">Verified age</option>
                    <option value="membership">Verified community membership</option>
                  </select>
                </label>
                {draft.eligibility !== 'account' && (
                  <label>
                    Required claim value
                    <input
                      required
                      value={draft.credentialValue}
                      onChange={(e) => setDraft({ ...draft, credentialValue: e.target.value })}
                    />
                    <small>
                      Credential-restricted polls remain unavailable until a genuine provider
                      verifies this claim.
                    </small>
                  </label>
                )}
                <div className="poll-dates">
                  <label>
                    Opens — optional
                    <input
                      type="datetime-local"
                      value={draft.opensAt}
                      onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })}
                    />
                  </label>
                  <label>
                    Closes
                    <input
                      required
                      type="datetime-local"
                      value={draft.closesAt}
                      onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
                    />
                  </label>
                </div>
                <p className="poll-small">
                  Publishing fixes the question, options, schedule, visibility, and eligibility.
                  Published rules cannot be edited.
                </p>
                <button className="poll-primary" type="submit" disabled={busy}>
                  <Plus size={18} />
                  Publish demo on this device
                </button>
              </form>
              <aside className="poll-panel">
                <h2>Before a live pilot</h2>
                <p>
                  Live organizer actions require independently verified Midnight Passport account
                  authority.
                </p>
                <ul>
                  {releaseBlockers().map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
                <h3>Published on this device</h3>
                {polls.map((poll) => (
                  <div className="poll-organizer-record" key={poll.id}>
                    <strong>{poll.question}</strong>
                    <span>
                      {VISIBILITY_COPY[poll.visibility].label} · {pollPhase(poll, now)}
                    </span>
                    <small className="poll-mono">Rules: {poll.rulesHash.slice(0, 18)}…</small>
                    <button
                      type="button"
                      onClick={() => {
                        saveFile(
                          JSON.stringify({ kind: 'midnight.vote/demo-poll/v1', poll }, null, 2),
                          `${poll.id}.demo-poll.json`,
                        );
                      }}
                    >
                      Download poll definition
                    </button>
                  </div>
                ))}
              </aside>
            </div>
          </>
        )}
        {tab === 'verify' && (
          <>
            <div className="poll-page-intro">
              <p className="poll-kicker">A record you can check.</p>
              <h1>Your answer. Your evidence.</h1>
              <p>
                Recover a private receipt and check its ballot commitment. Live chain confirmation
                and tally proofs are separate checks.
              </p>
            </div>
            <div className="poll-connect-grid">
              <section className="poll-panel poll-form">
                <ShieldCheck size={38} weight="thin" />
                <h2>Keep or restore your receipt</h2>
                <label>
                  Recovery passphrase
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="At least 12 characters"
                  />
                </label>
                <p className="poll-small">
                  Encryption happens on your device. The passphrase is never uploaded. Exported
                  files contain private choice material; keep them secure.
                </p>
                <div className="poll-button-row">
                  <button
                    className="poll-primary"
                    disabled={!receipt || busy || passphrase.length < 12}
                    type="button"
                    onClick={() => void download()}
                  >
                    Export encrypted receipt
                  </button>
                  <button
                    disabled={busy || passphrase.length < 12}
                    type="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    Restore receipt
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void restore(file);
                  }}
                />
                {receipt && (
                  <div className="poll-receipt">
                    <span className="poll-badge">
                      {receipt.environment === 'simulation'
                        ? 'Simulation receipt'
                        : 'Unverified imported Preview receipt'}
                    </span>
                    <dl className="poll-facts">
                      <dt>Poll</dt>
                      <dd>{receipt.opening.pollId}</dd>
                      <dt>Your private answer</dt>
                      <dd>
                        {polls.find((p) => p.id === receipt.opening.pollId)?.options[
                          receipt.opening.choice
                        ] ?? `Option ${receipt.opening.choice + 1}`}
                      </dd>
                      <dt>Commitment</dt>
                      <dd className="poll-mono">{receipt.commitment}</dd>
                    </dl>
                    <ol className="poll-verification-steps">
                      <li>Opening matches commitment — checked locally on import</li>
                      <li>Blockchain confirmation — not established</li>
                      <li>Included in final tally — not established</li>
                      <li>Aggregate proof — not established</li>
                    </ol>
                    <button
                      type="button"
                      onClick={() => {
                        setReceipt(null);
                        setPassphrase('');
                      }}
                    >
                      Clear private receipt from this view
                    </button>
                  </div>
                )}
              </section>
              <aside className="poll-panel">
                <h2>Verification has four parts.</h2>
                <p>
                  <strong>Submitted:</strong> the relay received a request.
                </p>
                <p>
                  <strong>Confirmed:</strong> the blockchain independently records the ballot.
                </p>
                <p>
                  <strong>Included:</strong> that ballot belongs to the complete set counted.
                </p>
                <p>
                  <strong>Finalized:</strong> the published result and its proof verify.
                </p>
                <p>
                  A receipt file alone cannot establish the last three. A future live verifier must
                  read canonical chain data and verify the tally proof.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void digest(releaseBlockers()).then((reportHash) =>
                      saveFile(
                        JSON.stringify(
                          { observedAt: '2026-11-09', blockers: releaseBlockers(), reportHash },
                          null,
                          2,
                        ),
                        'midnight-vote-capabilities.json',
                      ),
                    )
                  }
                >
                  Download capability status
                </button>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer className="poll-footer">
        <span>midnight.vote · Understand more. Disclose less.</span>
        <a href="https://github.com/tomasgarro/midnight-vote" target="_blank" rel="noreferrer">
          Source code <ArrowUpRight size={14} />
        </a>
        {import.meta.env.VITE_INCLUDE_LEGACY === 'true' && (
          <a href="/legacy.html#app">Previous consultation demo</a>
        )}
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              /* private storage may be unavailable */
            }
            setBallots([]);
            setReceipt(null);
            setPolls([]);
            setNotice('Local demonstration polls and this session’s answers cleared.');
          }}
        >
          Clear local demo data
        </button>
      </footer>
    </div>
  );
}
