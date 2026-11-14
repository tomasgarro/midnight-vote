import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Fingerprint,
  ListChecks,
  LockSimple,
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
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { MidnightMark } from '@/components/landing/MidnightMark';
import {
  MidnightPassportClient,
  type MidnightPassportConnection,
} from '@/integration/midnight-passport-client';
import { BRIEFINGS, examplePolls } from './poll-briefings';
import './poll-workspace.css';

const STORAGE_KEY = 'midnight.vote/restart/demo-polls/v2';
/** A static host has no verification service, so the build can switch the server check off. */
const ACCOUNT_CHECK = import.meta.env.VITE_POLL_ACCOUNT_CHECK !== 'off';
type Tab = 'polls' | 'organizer' | 'verify' | 'connect';
interface DemoBallot {
  pollId: string;
  choice: number;
  receipt: VoteReceipt;
  publicAccount?: string;
}
type Eligibility = 'account' | 'nationality' | 'residence' | 'age' | 'membership';

const tabFromHash = (): Tab =>
  window.location.hash === '#organizer'
    ? 'organizer'
    : window.location.hash === '#verify'
      ? 'verify'
      : window.location.hash === '#connect'
        ? 'connect'
        : 'polls';

const RESULTS: Record<Visibility, string> = {
  public: 'Results: each answer with its account',
  anonymous: 'Results: every answer, no names',
  private: 'Results: totals only',
};

const CLAIMS: Record<Exclude<Eligibility, 'account'>, string> = {
  nationality: 'Verified nationality',
  residence: 'Verified residence',
  age: 'Verified age',
  membership: 'Verified membership',
};

function when(time: number) {
  return new Date(time).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function day(time: number) {
  return new Date(time).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function phaseLabel(poll: PublishedPoll, now: number) {
  const phase = pollPhase(poll, now);
  if (phase === 'open') return `Open until ${day(poll.closesAt)}`;
  if (phase === 'scheduled') return `Opens ${day(poll.opensAt)}`;
  return 'Closed';
}

function whoMayAnswer(poll: Pick<PollDraft, 'eligibility'>) {
  return poll.eligibility.kind === 'midnight-passport-account'
    ? 'Anyone with a Midnight Passport account'
    : `Verified ${poll.eligibility.claim}: ${poll.eligibility.value || '…'}`;
}

function saveFile(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Arrow({ size = 18 }: { size?: number }) {
  return <ArrowUpRight className="app-arrow" size={size} weight="bold" aria-hidden="true" />;
}

/** The one honest line every page carries: what is real here and what is simulated. */
function DemoNote() {
  return (
    <p className="app-demo-note">
      <span className="app-chip app-chip--accent">Demo</span>
      Sign-in uses the real Midnight Passport. Answers and receipts are simulated on this device;
      nothing is sent to Midnight.
    </p>
  );
}

function Intro({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <div className="app-intro">
      <h1>{title}</h1>
      <p className="app-lead">{lead}</p>
      {children}
    </div>
  );
}

function Face() {
  return (
    <span className="app-face" aria-hidden="true">
      <img src="/art/civic/cleisthenes-bust.webp" alt="" />
    </span>
  );
}

function BriefingCard({ poll }: { poll: PublishedPoll }) {
  const briefing = BRIEFINGS[poll.id];
  const titleId = useId();
  return (
    <section className="app-card app-brief" aria-labelledby={titleId}>
      <div className="app-brief__by">
        <Face />
        <p>
          <strong id={titleId}>Cleisthenes</strong>
          <span>
            {briefing
              ? 'Here is what each side says, and who says it.'
              : 'No sources for this poll yet.'}
          </span>
        </p>
      </div>
      {briefing ? (
        <>
          <p className="app-brief__summary">{briefing.summary}</p>
          <div className="app-brief__sides">
            {(['for', 'against'] as const).map((side) => (
              <div className="app-side" key={side}>
                <small>{side === 'for' ? 'For' : 'Against'}</small>
                <ul>
                  {briefing[side].map((item) => (
                    <li key={item.point}>
                      <p>{item.point}</p>
                      <span>{item.source}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="app-small">
            An example briefing written for this demo; the sources named are examples. Cleisthenes
            never tells you how to vote.
          </p>
        </>
      ) : (
        <p className="app-small">
          When an organizer adds sources, Cleisthenes sets out what each side says here.
        </p>
      )}
    </section>
  );
}

function RulesCard({
  question,
  visibility,
  eligibility,
  closesAt,
  rulesHash,
  preview = false,
}: {
  question?: string;
  visibility: Visibility;
  eligibility: PollDraft['eligibility'];
  closesAt?: number;
  rulesHash?: string;
  preview?: boolean;
}) {
  return (
    <section className="app-card app-rules" aria-label={preview ? 'Preview of the rules' : 'Rules'}>
      <p className="app-label">{preview ? 'Preview' : 'The rules'}</p>
      {question !== undefined && (
        <p className="app-rules__q">{question.trim() || 'Your question appears here.'}</p>
      )}
      <ul>
        <li>
          <Check size={16} weight="bold" aria-hidden="true" /> {whoMayAnswer({ eligibility })}
        </li>
        <li>
          <Check size={16} weight="bold" aria-hidden="true" />
          <span>
            {RESULTS[visibility]}
            <small>{VISIBILITY_COPY[visibility].description}</small>
          </span>
        </li>
        <li>
          <Check size={16} weight="bold" aria-hidden="true" />
          {closesAt && Number.isFinite(closesAt)
            ? `Closes ${when(closesAt)}`
            : 'Closing time to set'}
        </li>
      </ul>
      <p className="app-rules__lock">
        <LockSimple size={15} weight="bold" aria-hidden="true" />
        {preview ? 'Rules lock when the poll opens' : 'Rules locked when the poll opened'}
      </p>
      {rulesHash && (
        <p className="app-small app-mono">Rules fingerprint {rulesHash.slice(0, 16)}…</p>
      )}
    </section>
  );
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
    eligibility: 'account' as Eligibility,
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
    document.title = 'midnight.vote — Polls';
    document.documentElement.lang = 'en';
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
      const result = await Promise.all(
        examplePolls(start).map((p) => publishPoll(p, 'simulation', start)),
      );
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
      setNotice('');
      window.scrollTo({ top: 0 });
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

  const openPoll = (poll: PublishedPoll | null) => {
    setSelected(poll);
    setChoice(null);
    setPublicConsent(false);
    setNotice('');
    window.scrollTo({ top: 0 });
  };

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
            : { kind: 'credential', claim: draft.eligibility, value: draft.credentialValue },
        opensAt: draft.opensAt ? new Date(draft.opensAt).getTime() : Date.now(),
        closesAt: new Date(draft.closesAt).getTime(),
      };
      const published = await publishPoll(value, 'simulation');
      setPolls((previous) => [...previous, published]);
      setNotice(
        'Demo poll published on this device. Its question, options, schedule, results and who may answer are now locked. Live publishing is not available yet.',
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

  const answered = selected ? ballots.find((b) => b.pollId === selected.id) : undefined;
  const selectedPhase = selected ? pollPhase(selected, now) : 'closed';
  const draftCloses = draft.closesAt ? new Date(draft.closesAt).getTime() : undefined;
  const nav: { tab: Tab; href: string; label: string; icon: ReactNode }[] = [
    { tab: 'polls', href: '#polls', label: 'Polls', icon: <ListChecks size={20} /> },
    { tab: 'organizer', href: '#organizer', label: 'Run a poll', icon: <Plus size={20} /> },
    { tab: 'verify', href: '#verify', label: 'Verify', icon: <ShieldCheck size={20} /> },
  ];

  return (
    <div className="poll-workspace">
      <a className="poll-skip" href="#poll-main">
        Skip to content
      </a>
      <div className="app-header-wrap">
        <header className="app-header">
          <a href="/" className="app-brand" aria-label="midnight.vote home">
            <img src="/brand/midnight-vote-d3-black.svg" width="40" height="23" alt="" />
            <span>
              midnight<span className="app-brand__suffix">.vote</span>
            </span>
          </a>
          <nav className="app-nav" aria-label="Poll workspace">
            {nav.map((item) => (
              <a
                key={item.tab}
                href={item.href}
                aria-current={tab === item.tab ? 'page' : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <a
            className="app-passport"
            data-connected={connection ? 'true' : undefined}
            href="#connect"
            aria-current={tab === 'connect' ? 'page' : undefined}
          >
            <Fingerprint size={18} weight={connection ? 'fill' : 'regular'} />
            <span className="app-passport__label">
              {connection?.displayName ?? 'Midnight Passport'}
            </span>
          </a>
        </header>
      </div>
      <main id="poll-main" className="app-main" tabIndex={-1}>
        {notice && (
          <div className="app-notice" role="status">
            <p>{notice}</p>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}

        {tab === 'connect' && (
          <>
            <Intro
              title="Sign in with Midnight Passport."
              lead="Create or connect your account in the official Midnight Passport window. You choose which profile details to share."
            />
            <div className="app-split">
              <section className="app-card app-connect">
                <div className="app-cover" aria-hidden="true">
                  <span>Passport</span>
                  <MidnightMark className="app-cover__mark" />
                  <span>Midnight Network</span>
                </div>
                <div className="app-connect__body">
                  <h2>
                    {connection ? 'Your profile is connected.' : 'One way in, no seed phrase.'}
                  </h2>
                  {connection ? (
                    <>
                      <dl className="app-facts">
                        <dt>Display name</dt>
                        <dd>{connection.displayName ?? 'Not shared'}</dd>
                        <dt>Account network</dt>
                        <dd>{connection.account?.network ?? 'Account not shared'}</dd>
                        <dt>Account</dt>
                        <dd className="app-mono">{connection.account?.address ?? 'Not shared'}</dd>
                        <dt>Voting authority</dt>
                        <dd>Unavailable — profile consent is not an account-control proof</dd>
                        <dt>Preview compatibility</dt>
                        <dd>
                          {connection.account?.network === 'stagenet'
                            ? 'Different network — this is a Stagenet account'
                            : 'Preview account authority still needs verification'}
                        </dd>
                      </dl>
                      {connection.account && ACCOUNT_CHECK && (
                        <>
                          <button
                            className="app-pill"
                            type="button"
                            disabled={connecting}
                            onClick={() => void verifyAccount()}
                          >
                            {connecting ? 'Starting verification…' : 'Check account verification'}
                          </button>
                          <p className="app-small">
                            Checks a fresh signed response on our server. The current Midnight
                            Passport connector cannot yet prove account authority.
                          </p>
                        </>
                      )}
                      {accountVerification && (
                        <div className="app-report" role="status">
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
                      <div className="app-actions">
                        <a className="app-pill" href="#polls">
                          Try a poll <Arrow />
                        </a>
                        <button
                          className="app-pill app-pill--ghost"
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
                      </div>
                    </>
                  ) : (
                    <>
                      <p>
                        midnight.vote never asks for a seed phrase, a payment or a scan of your
                        travel passport.
                      </p>
                      <div className="app-actions">
                        <button
                          className="app-pill"
                          type="button"
                          disabled={connecting}
                          onClick={() => void connect()}
                        >
                          {connecting
                            ? 'Waiting for Midnight Passport…'
                            : 'Create or connect Midnight Passport'}
                          <Arrow />
                        </button>
                        {connecting && (
                          <button
                            className="app-pill app-pill--ghost"
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
                      </div>
                      <button
                        className="app-text-button"
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
                </div>
              </section>
              <aside className="app-card app-aside">
                <h2>Signing in and being eligible are separate.</h2>
                <p>
                  Your Midnight Passport account is the way in. Open polls will ask for proof that
                  you control that account, with one answer per account.
                </p>
                <p>
                  Polls for one country, an age or a membership need a proven fact as well. That
                  comes with verifiable credentials, planned for Midnight Passport v2 (Q1 2027).
                </p>
                <p className="app-small">
                  Current account network: Stagenet. Voting target: Midnight Preview. A Stagenet
                  profile does not become a Preview account.
                </p>
                <details>
                  <summary>What upstream and midnight.vote still have to build</summary>
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

        {tab === 'polls' && !selected && (
          <>
            <Intro
              title="Understand before you answer."
              lead="Each poll comes with Cleisthenes’ briefing: what each side says, and who says it. Then the answer is yours."
            >
              <DemoNote />
            </Intro>
            <div className="app-poll-grid">
              {polls.map((poll) => {
                const briefing = BRIEFINGS[poll.id];
                const done = ballots.some((b) => b.pollId === poll.id);
                return (
                  <article className="app-card app-poll-card" key={poll.id}>
                    <div className="app-poll-card__top">
                      <span className="app-chip">{VISIBILITY_COPY[poll.visibility].label}</span>
                      <span className="app-status" data-phase={pollPhase(poll, now)}>
                        {done ? 'Answered' : phaseLabel(poll, now)}
                      </span>
                    </div>
                    <h2>{poll.question}</h2>
                    <p>{poll.description}</p>
                    <div className="app-poll-card__by">
                      <Face />
                      <span>
                        <strong>Cleisthenes</strong>
                        {briefing
                          ? `${briefing.for.length + briefing.against.length} points, both sides`
                          : 'No briefing yet'}
                      </span>
                    </div>
                    <div className="app-poll-card__foot">
                      <span>{whoMayAnswer(poll)}</span>
                      <button type="button" className="app-pill" onClick={() => openPoll(poll)}>
                        Open poll <Arrow />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {tab === 'polls' && selected && (
          <div className="app-ballot">
            <section className="app-ballot__main" aria-labelledby="ballot-question">
              <button type="button" className="app-back" onClick={() => openPoll(null)}>
                <ArrowLeft size={16} weight="bold" /> All polls
              </button>
              <div className="app-chips">
                <span className="app-chip">{VISIBILITY_COPY[selected.visibility].label}</span>
                <span className="app-status" data-phase={selectedPhase}>
                  {phaseLabel(selected, now)}
                </span>
                <span className="app-chip app-chip--accent">Demo</span>
              </div>
              <h1 id="ballot-question">{selected.question}</h1>
              <p className="app-lead">{selected.description}</p>
              <div className="app-ballot__brief-inline">
                <BriefingCard poll={selected} />
              </div>

              {answered ? (
                <div className="app-card app-saved" role="status">
                  <span className="app-seal" aria-hidden="true">
                    <Check size={26} weight="bold" />
                  </span>
                  <div>
                    <h2>Your demo answer is saved.</h2>
                    <p>
                      You chose <strong>{selected.options[answered.choice]}</strong>. Nothing was
                      sent to Midnight: the answer stays in this browser session. In the live
                      design, an accepted answer is counted without another visit.
                    </p>
                    <div className="app-actions">
                      <a className="app-pill" href="#verify">
                        Keep a receipt <Arrow />
                      </a>
                      <button
                        type="button"
                        className="app-pill app-pill--ghost"
                        onClick={() => openPoll(null)}
                      >
                        Back to polls
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <form
                  className="app-answer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void simulateVote();
                  }}
                >
                  <fieldset
                    disabled={
                      selectedPhase !== 'open' ||
                      selected.eligibility.kind !== 'midnight-passport-account'
                    }
                  >
                    <legend>Your answer</legend>
                    {selected.options.map((option, index) => (
                      <label className="app-option" key={option}>
                        <input
                          type="radio"
                          name="choice"
                          checked={choice === index}
                          onChange={() => setChoice(index)}
                        />
                        <span className="app-option__dot" aria-hidden="true" />
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                  {selected.eligibility.kind !== 'midnight-passport-account' && (
                    <p className="app-unavailable">
                      Requires verified {selected.eligibility.claim}: {selected.eligibility.value}.
                      Proving it needs verifiable credentials, planned for Midnight Passport v2 (Q1
                      2027), so this poll cannot take answers yet. Choosing a country or connecting
                      a profile does not grant eligibility.
                    </p>
                  )}
                  {selected.visibility === 'public' && (
                    <label className="app-consent">
                      <input
                        type="checkbox"
                        checked={publicConsent}
                        onChange={(event) => setPublicConsent(event.target.checked)}
                      />
                      <span>
                        I understand that a public poll publishes the account and its choice after
                        closing. This demonstration uses a simulated account.
                      </span>
                    </label>
                  )}
                  {selectedPhase === 'open' && (
                    <button
                      className="app-pill app-pill--large"
                      type="submit"
                      disabled={
                        choice === null ||
                        (selected.visibility === 'public' && !publicConsent) ||
                        busy ||
                        selected.eligibility.kind !== 'midnight-passport-account'
                      }
                    >
                      Save a demo answer <Check size={18} weight="bold" />
                    </button>
                  )}
                </form>
              )}

              {selectedPhase === 'closed' && (
                <div className="app-card app-results">
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
            <aside className="app-ballot__side">
              <BriefingCard poll={selected} />
              <RulesCard
                visibility={selected.visibility}
                eligibility={selected.eligibility}
                closesAt={selected.closesAt}
                rulesHash={selected.rulesHash}
              />
            </aside>
          </div>
        )}

        {tab === 'organizer' && (
          <>
            <Intro
              title="Run a poll for your group."
              lead="Ask your club, your class or your building. Choose who can answer and what the results show; the rules lock when the poll opens."
            >
              <DemoNote />
            </Intro>
            <div className="app-organizer">
              <form className="app-card app-form" onSubmit={(event) => void publishDemo(event)}>
                <h2>Your question</h2>
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
                    placeholder="A sentence or two so everyone knows what is being decided."
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
                <fieldset className="app-modes">
                  <legend>What becomes public after closing?</legend>
                  {(['private', 'anonymous', 'public'] as const).map((mode) => (
                    <label className="app-mode" key={mode}>
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
                    onChange={(e) =>
                      setDraft({ ...draft, eligibility: e.target.value as Eligibility })
                    }
                  >
                    <option value="account">Anyone with a Midnight Passport account</option>
                    {(Object.keys(CLAIMS) as (keyof typeof CLAIMS)[]).map((claim) => (
                      <option key={claim} value={claim}>
                        {CLAIMS[claim]} (Midnight Passport v2)
                      </option>
                    ))}
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
                      Proven facts like this come with verifiable credentials, planned for Midnight
                      Passport v2 (Q1 2027). Until then this poll cannot take answers.
                    </small>
                  </label>
                )}
                <div className="app-dates">
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
                <button className="app-pill app-pill--large" type="submit" disabled={busy}>
                  <Plus size={18} weight="bold" />
                  Publish demo on this device
                </button>
                <p className="app-small">
                  Publishing locks the question, options, schedule, results and who may answer.
                  Nobody can edit them afterwards, the organizer included.
                </p>
              </form>
              <aside className="app-organizer__side">
                <RulesCard
                  preview
                  question={draft.question}
                  visibility={draft.visibility}
                  eligibility={
                    draft.eligibility === 'account'
                      ? { kind: 'midnight-passport-account' }
                      : {
                          kind: 'credential',
                          claim: draft.eligibility,
                          value: draft.credentialValue,
                        }
                  }
                  closesAt={draftCloses}
                />
                <section className="app-card app-records">
                  <h2>Your polls on this device</h2>
                  {polls.map((poll) => (
                    <div className="app-record" key={poll.id}>
                      <strong>{poll.question}</strong>
                      <span>
                        {VISIBILITY_COPY[poll.visibility].label} · {phaseLabel(poll, now)}
                      </span>
                      <button
                        type="button"
                        className="app-text-button"
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
                  <details>
                    <summary>Before a live pilot</summary>
                    <p className="app-small">
                      Live organizer actions need independently verified Midnight Passport account
                      authority.
                    </p>
                    <ul>
                      {releaseBlockers().map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </details>
                </section>
              </aside>
            </div>
          </>
        )}

        {tab === 'verify' && (
          <>
            <Intro
              title="Keep a receipt you can check."
              lead="Save your answer as an encrypted file. Restore it later to check that it matches your ballot commitment."
            >
              <DemoNote />
            </Intro>
            <div className="app-split">
              <section className="app-card app-form">
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
                <p className="app-small">
                  Encryption happens on your device and the passphrase is never uploaded. The file
                  holds your private choice, so keep it safe.
                </p>
                <div className="app-actions">
                  <button
                    className="app-pill"
                    disabled={!receipt || busy || passphrase.length < 12}
                    type="button"
                    onClick={() => void download()}
                  >
                    Export encrypted receipt
                  </button>
                  <button
                    className="app-pill app-pill--ghost"
                    disabled={busy || passphrase.length < 12}
                    type="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    Restore receipt
                  </button>
                </div>
                {!receipt && (
                  <p className="app-small">
                    No receipt yet. <a href="#polls">Answer a demo poll</a> first, or restore a file
                    you kept.
                  </p>
                )}
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
                  <div className="app-receipt">
                    <span className="app-chip app-chip--accent">
                      {receipt.environment === 'simulation'
                        ? 'Simulation receipt'
                        : 'Unverified imported Preview receipt'}
                    </span>
                    <dl className="app-facts">
                      <dt>Poll</dt>
                      <dd>
                        {polls.find((p) => p.id === receipt.opening.pollId)?.question ??
                          receipt.opening.pollId}
                      </dd>
                      <dt>Your private answer</dt>
                      <dd>
                        {polls.find((p) => p.id === receipt.opening.pollId)?.options[
                          receipt.opening.choice
                        ] ?? `Option ${receipt.opening.choice + 1}`}
                      </dd>
                      <dt>Commitment</dt>
                      <dd className="app-mono">{receipt.commitment}</dd>
                    </dl>
                    <ol className="app-checks">
                      <li data-done="true">
                        Opening matches commitment — checked locally on import
                      </li>
                      <li>Blockchain confirmation — not established</li>
                      <li>Included in final tally — not established</li>
                      <li>Aggregate proof — not established</li>
                    </ol>
                    <button
                      type="button"
                      className="app-text-button"
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
              <aside className="app-card app-aside">
                <h2>Four checks, one answer.</h2>
                <ol className="app-steps">
                  <li>
                    <strong>Submitted</strong> The relay received your answer.
                  </li>
                  <li>
                    <strong>Confirmed</strong> The blockchain records the ballot on its own.
                  </li>
                  <li>
                    <strong>Included</strong> The ballot is in the complete set that was counted.
                  </li>
                  <li>
                    <strong>Finalized</strong> The published result and its proof verify.
                  </li>
                </ol>
                <p className="app-small">
                  A receipt file alone cannot prove the last three. A live verifier will read the
                  chain and check the tally proof.
                </p>
                <button
                  type="button"
                  className="app-text-button"
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
      <footer className="app-footer">
        <div className="app-footer__brand">
          <a href="/" className="app-brand">
            <img src="/brand/midnight-vote-d3-black.svg" width="34" height="20" alt="" />
            <span>
              midnight<span className="app-brand__suffix">.vote</span>
            </span>
          </a>
          <p>Understand more. Disclose less.</p>
        </div>
        <nav aria-label="Footer">
          <a href="#polls">Polls</a>
          <a href="#organizer">Run a poll</a>
          <a href="#verify">Verify</a>
          <a href="/docs">Docs</a>
          <a href="/feedback">Feedback</a>
          <a href="https://github.com/tomasgarro/midnight-vote" target="_blank" rel="noreferrer">
            Source code <Arrow size={13} />
          </a>
          <a href="https://midnight.network" target="_blank" rel="noreferrer">
            Midnight <Arrow size={13} />
          </a>
          {import.meta.env.VITE_INCLUDE_LEGACY === 'true' && (
            <a href="/legacy.html#app">Previous consultation demo</a>
          )}
        </nav>
        <button
          type="button"
          className="app-text-button"
          onClick={() => {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              /* private storage may be unavailable */
            }
            setBallots([]);
            setReceipt(null);
            setPolls([]);
            openPoll(null);
            setNotice('Local demonstration polls and this session’s answers cleared.');
          }}
        >
          Clear local demo data
        </button>
      </footer>
      <nav className="app-tabbar" aria-label="Poll workspace, phone">
        {nav.map((item) => (
          <a key={item.tab} href={item.href} aria-current={tab === item.tab ? 'page' : undefined}>
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
