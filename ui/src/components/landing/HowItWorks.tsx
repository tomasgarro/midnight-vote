import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GlobeHemisphereWest,
  LockKey,
  ShieldCheck,
  Sparkle,
  UserCircle,
  WifiHigh,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import bust from '@/assets/companion/cleisthenes-bust.webp';
import './how-it-works.css';
import './story-refinement.css';

const steps = [
  {
    title: 'Make an introduction.\nKeep your privacy.',
    label: 'Connect',
    heading: 'Connect your Midnight Passport',
    text: 'Start with your Passport. Review the information requested and choose what you consent to share.',
    detail: 'Connecting your account is the introduction. Proving eligibility comes next.',
    action: 'Explore Passport',
  },
  {
    title: 'Prove you belong.\nKeep the details.',
    label: 'Prove',
    heading: 'Prove your eligibility',
    text: 'The idea is simple: prove you meet a consultation’s rules without attaching your identity to your answer.',
    detail:
      'Passport and NFC verification are the direction. Today’s demo uses a clearly labelled simulated pass.',
    action: 'Try the privacy lesson',
  },
  {
    title: 'A shared future.\nA voice of your own.',
    label: 'Participate',
    heading: 'Join the conversation',
    text: 'Explore a consultation, make your choice, and see how private participation can work.',
    detail: 'Try a non-binding demo vote. It is simulated, and it says so.',
    action: 'Explore the demo',
  },
] as const;

function PassportScene() {
  return (
    <div className="how-art how-art--passport" aria-hidden="true">
      <div className="how-art__orbit" />
      <div className="how-digital-account">
        <div className="how-account-dots">
          <i />
          <i />
          <i />
        </div>
        <UserCircle size={72} weight="thin" />
        <strong>Your digital account</strong>
        <span>One connection. Your consent.</span>
        <div className="how-account-link">
          <span />
          <LockKey size={19} />
          <span />
        </div>
      </div>
      <div className="how-consent">
        <div className="how-ui-top">
          <img src="/brand/midnight-symbol-white.svg" alt="" width="24" height="24" />
          <span>Midnight Passport</span>
          <span>↗</span>
        </div>
        <p>A little introduction.</p>
        <strong>You choose what to share.</strong>
        <div className="how-field">
          <span>Display name</span>
          <span className="how-sample">Alex</span>
          <Check size={16} />
        </div>
        <div className="how-field">
          <span>Profile image</span>
          <span>Optional</span>
          <span className="how-toggle" />
        </div>
        <div className="how-private">
          <LockKey size={15} /> Your vote is a separate step.
        </div>
        <div className="how-ui-button">
          Review connection <ArrowUpRight className="landing-action-arrow" size={16} />
        </div>
      </div>
      <span className="how-art__badge">
        <Check size={16} /> Consent comes first
      </span>
    </div>
  );
}

function ProofScene() {
  return (
    <div className="how-art how-art--proof" aria-hidden="true">
      <div className="how-art__orbit" />
      <div className="how-physical-passport">
        <div className="how-passport-cover">
          <GlobeHemisphereWest size={38} weight="thin" />
          <strong>PASSPORT</strong>
          <WifiHigh size={25} />
        </div>
        <div className="how-passport-page">
          <span>TRAVEL DOCUMENT · SPECIMEN</span>
          <div className="how-passport-identity">
            <UserCircle size={35} weight="thin" />
            <div>
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="how-passport-mrz">
            P&lt;XXX&lt;&lt;SAMPLE&lt;&lt;&lt;&lt;&lt;
            <br />
            000000&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
          </div>
          <div className="how-passport-scan" />
        </div>
      </div>
      <div className="how-proof-path">
        <span />
        <span />
        <span />
      </div>
      <div className="how-proof-compute">
        <LockKey size={16} />
        <span>Verify → prove</span>
        <code>0x7a · 9f · c2</code>
      </div>
      <div className="how-proof-seal">
        <ShieldCheck size={60} weight="thin" />
        <span>A ZK proof.</span>
        <strong>Not your life story.</strong>
      </div>
      <div className="how-proof-result">
        <span>
          <Check size={17} /> Eligibility rule met
        </span>
        <small>Illustration · simulated in the demo</small>
      </div>
      <span className="how-art__badge">
        <WifiHigh size={18} /> NFC passport check → ZK proof
      </span>
    </div>
  );
}

function VoteScene() {
  return (
    <div className="how-art how-art--vote" aria-hidden="true">
      <div className="how-art__orbit" />
      <div className="how-vote-card">
        <div className="how-ui-top">
          <span className="how-live-dot" />
          <span>A shared question</span>
          <span>DEMO</span>
        </div>
        <p>
          What should our city
          <br />
          prioritise next?
        </p>
        <div className="how-vote-option">
          More green spaces <span />
        </div>
        <div className="how-vote-option how-vote-option--selected">
          Better public transport <Check size={17} />
        </div>
        <div className="how-vote-option">
          Community spaces <span />
        </div>
        <div className="how-ui-button">
          Your voice matters <ArrowRight size={16} />
        </div>
      </div>
      <div className="how-receipt">
        <ShieldCheck size={28} />
        <span>
          A receipt for you.<small>Your choice stays private.</small>
        </span>
      </div>
      <span className="how-art__badge">
        <Sparkle size={17} /> Small acts. Shared possibilities.
      </span>
    </div>
  );
}

const scenes = [PassportScene, ProofScene, VoteScene];

export function HowItWorks({ onStart }: { onStart: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(
      '(min-width: 960px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)',
    );
    const sync = () => setPinned(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const heading = intro.current;
      if (heading) {
        const rect = heading.getBoundingClientRect();
        const progress = Math.max(
          0,
          Math.min(1, (110 - rect.top) / Math.max(1, rect.height - (window.innerHeight - 110))),
        );
        const blend = Math.max(0, Math.min(1, (progress - 0.2) / 0.6));
        heading.style.setProperty('--headline-progress', String(blend));
      }
      const element = track.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const stage = element.querySelector<HTMLElement>('.how-stage');
      const travel = rect.height - (stage?.offsetHeight ?? window.innerHeight - 110);
      const progress = Math.max(0, Math.min(1, (110 - rect.top) / Math.max(1, travel)));
      setActive(Math.min(2, Math.floor(progress * 3)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [pinned]);

  const goTo = (index: number) => {
    const element = track.current;
    const stage = element?.querySelector<HTMLElement>('.how-stage');
    if (!element || !stage) return;
    const start = window.scrollY + element.getBoundingClientRect().top - 110;
    const travel = element.offsetHeight - stage.offsetHeight;
    window.scrollTo({ top: start + travel * ((index + 0.15) / 3), behavior: 'smooth' });
  };

  return (
    <section className="how-section" id="how-it-works" aria-labelledby="landing-how-title">
      <div className="how-intro" ref={intro} data-pinned={pinned}>
        <div className="how-intro__sticky">
          <h2 id="landing-how-title">
            <span className="how-intro__first">A little less exposure.</span>
            <span className="how-intro__second">A lot more possibility.</span>
          </h2>
        </div>
      </div>
      <div className="how-track" ref={track} data-pinned={pinned} data-step={active + 1}>
        <div className="how-stage">
          {pinned && (
            <nav className="how-progress" aria-label="How it works steps">
              {steps.map((step, index) => (
                <button
                  type="button"
                  key={step.label}
                  onClick={() => goTo(index)}
                  aria-current={active === index ? 'step' : undefined}
                >
                  <span>0{index + 1}</span>
                  {step.label}
                  <i />
                </button>
              ))}
            </nav>
          )}
          <div className="how-panels">
            {steps.map((step, index) => {
              const Scene = scenes[index] ?? PassportScene;
              const inactive = pinned && active !== index;
              return (
                <article
                  key={step.label}
                  className="how-panel"
                  data-active={!inactive}
                  aria-hidden={inactive || undefined}
                  inert={inactive || undefined}
                  aria-labelledby={`how-step-${index}`}
                >
                  <Scene />
                  <div className="how-copy">
                    <p className="how-number">
                      0{index + 1} <span>/ {step.label}</span>
                    </p>
                    <h3 id={`how-step-${index}`}>
                      {step.title.split('\n').map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                    </h3>
                    <h4>{step.heading}</h4>
                    <p>{step.text}</p>
                    <p className="how-detail">{step.detail}</p>
                    {index === 2 && (
                      <aside className="how-ai-preview" aria-label="Cleisthenes, the guide">
                        <div className="how-ai-robot" aria-hidden="true">
                          <img src={bust} alt="" width="46" height="46" />
                        </div>
                        <div>
                          <strong>More context. Your own conclusion.</strong>
                          <p>
                            Cleisthenes explains each consultation from its sources: what is asked,
                            what each side says, and who says it. He never says how to answer.
                          </p>
                          <small>In the app today</small>
                        </div>
                      </aside>
                    )}
                    <button type="button" className="how-action" onClick={onStart}>
                      {step.action}
                      <ArrowUpRight className="landing-action-arrow" size={19} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
      <div className="how-outro">
        <LockKey size={19} />
        <p>
          What you choose to share should always be <strong>your choice.</strong>
        </p>
      </div>
    </section>
  );
}
