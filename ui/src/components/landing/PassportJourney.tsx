import { useEffect, useRef, useState } from 'react';
import { HERO_ASSETS } from './hero-assets';
import { PassportChapter } from './PassportChapter';
import { PorticoHero } from './PorticoHero';
import './portico-hero.css';
import './passport-chapter.css';
import { loadScroll, SCROLL_SCENES, useMediaQuery } from './scroll';

/** The ring's opening, as a share of its outer diameter. */
const RING_OPENING = 0.8156;
/** Timeline positions, in screens of scrolling. */
const LOGO_AT = 1.3;
const PHRASE_AT = 1.95;
const PARTS_AT = 3.0;
const PART_LENGTH = 0.8;
const STEPS = 5;
const END_AT = PARTS_AT + STEPS * PART_LENGTH;

/**
 * The hero and the chapter share one pinned stage. Scrolling flies through the portico and into the
 * passport; the Midnight symbol on the cover becomes a doorway, the dusk shows through it, and the
 * camera passes through. Inside, the symbol builds itself again and then carries the five steps of
 * how Midnight Passport works. Without motion the same content is a plain page.
 */
export function PassportJourney({ onStart }: { onStart: () => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const revealAllowed = useRef(true);
  const wantsMotion = useMediaQuery(SCROLL_SCENES);
  const [failed, setFailed] = useState(false);
  const motion = wantsMotion && !failed;

  useEffect(() => {
    const section = sectionRef.current;
    if (!motion || !section) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    loadScroll()
      .then(({ gsap, ScrollTrigger }) => {
        if (cancelled) return;
        const context = gsap.context(() => {
          const stage = section.querySelector<HTMLElement>('.journey-stage');
          const chapter = section.querySelector<HTMLElement>('.pc');
          const wrap = section.querySelector<HTMLElement>('.ph-hand-wrap');
          const hand = section.querySelector<HTMLElement>('.hero-hand');
          const markBox = section.querySelector<HTMLElement>('.pc-mark');
          const mark = markBox?.querySelector<SVGSVGElement>('svg');
          if (!stage || !chapter || !wrap || !hand || !markBox || !mark) return;
          const { symbol } = HERO_ASSETS;

          const W = () => stage.clientWidth;
          const H = () => stage.clientHeight;
          const logoX = () => wrap.offsetLeft + hand.offsetLeft + symbol.x * hand.offsetWidth;
          const logoY = () => wrap.offsetTop + hand.offsetTop + symbol.y * hand.offsetHeight;
          /** Enough zoom for the ring's opening to cover the whole stage: then we are through. */
          const through = () =>
            (Math.hypot(W(), H()) / (RING_OPENING * symbol.size * hand.offsetWidth)) * 1.3;

          gsap.set(hand, {
            transformOrigin: `${symbol.x * 100}% ${symbol.y * 100}%`,
            '--cover-flat': 0,
          });
          gsap.set(markBox, { autoAlpha: 0 });

          const timeline = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: 'bottom bottom',
              scrub: 0.6,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                // the hand stays interactive until the zoom really starts (0.12 of 5.4+ screens)
                revealAllowed.current = self.progress < 0.02;
              },
              onRefresh: (self) => {
                const anchor = anchorRef.current;
                if (anchor)
                  anchor.style.top = `${((PHRASE_AT + 0.55) / timeline.duration()) * (self.end - self.start)}px`;
              },
            },
          });

          // 1. Through the portico, into the passport, through the ring.
          timeline
            .to(
              '.ph-copy',
              { autoAlpha: 0, y: -50, filter: 'blur(6px)', duration: 0.25, ease: 'power1.in' },
              0,
            )
            .to('.ph-portico', { scale: 2.8, duration: 0.6, ease: 'power2.in' }, 0)
            .to('.ph-portico', { autoAlpha: 0, duration: 0.15 }, 0.45)
            .to('.ph-sky', { scale: 1.35, duration: 1.2 }, 0)
            .to(
              hand,
              {
                scale: through,
                x: () => W() / 2 - logoX(),
                y: () => H() / 2 - logoY(),
                duration: 1.13,
                ease: 'power3.in',
              },
              0.12,
            )
            .to(hand, { '--cover-flat': 1, duration: 0.35 }, 0.4)
            .fromTo(
              '.hero-hand__symbol--zoom',
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 0.1 },
              0.55,
            )
            .fromTo(
              '.hero-hand__portal',
              { opacity: 0, '--portal-light': 1 },
              { opacity: 1, duration: 0.18 },
              0.62,
            )
            // the squares step aside: only the ring is the doorway
            .to(
              '.hero-hand__symbol--zoom .midnight-mark__square',
              { opacity: 0, duration: 0.14, stagger: 0.03 },
              0.66,
            )
            .to('.hero-hand__portal', { '--portal-light': 0, duration: 0.2 }, 0.98)
            .to('.hero-hand__symbol--zoom', { autoAlpha: 0, duration: 0.15 }, 1.04)
            .fromTo('.pc-ground', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02 }, 1.22)
            .set('.ph', { autoAlpha: 0 }, 1.25);

          // 2. In the night, the Midnight symbol appears as it is printed, and the Alps at dusk come
          //    up behind it, rising into place by the first step.
          timeline
            .set(markBox, { x: 0, y: 0 }, LOGO_AT)
            .fromTo(
              markBox,
              { autoAlpha: 0, scale: 1.9 },
              { autoAlpha: 1, scale: 1.6, duration: 0.3, ease: 'power2.out' },
              LOGO_AT,
            )
            .fromTo('.pc-dusk', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, LOGO_AT + 0.3)
            .fromTo(
              '.pc-dusk img',
              { yPercent: 18 },
              { yPercent: 0, duration: PARTS_AT - LOGO_AT - 0.3, ease: 'power1.out' },
              LOGO_AT + 0.3,
            );

          // 3. The phrase under the symbol, word by word; then the symbol leaves the stage to the
          //    steps.
          timeline
            .to(markBox, { y: () => -0.14 * H(), duration: 0.3, ease: 'power2.inOut' }, PHRASE_AT)
            .fromTo(
              '.pc-word',
              { autoAlpha: 0, y: 14, filter: 'blur(8px)' },
              { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.12, stagger: 0.04 },
              PHRASE_AT + 0.1,
            )
            .to(
              [markBox, '.pc-phrase'],
              { autoAlpha: 0, y: '-=24', duration: 0.15 },
              PARTS_AT - 0.35,
            )
            .to(
              '.pc-ground',
              { clipPath: 'inset(14px 14px 14px 14px round 32px)', duration: 0.2 },
              PARTS_AT - 0.35,
            );

          // 4. The five steps take turns; the bar loads one segment per step.
          for (let index = 0; index < STEPS; index += 1) {
            const at = PARTS_AT + index * PART_LENGTH;
            const part = `.pc-part--${index + 1}`;
            timeline
              .fromTo(
                `${part} .pc-steps [data-state="now"] i`,
                { scaleX: 0 },
                { scaleX: 1, duration: PART_LENGTH - 0.1, ease: 'none' },
                at,
              )
              .fromTo(
                `${part} .pc-part__text`,
                { autoAlpha: 0, y: 28 },
                { autoAlpha: 1, y: 0, duration: 0.15, ease: 'power2.out' },
                at,
              )
              .fromTo(
                `${part} .pc-part__figure`,
                { autoAlpha: 0, y: 24 },
                { autoAlpha: 1, y: 0, duration: 0.15, ease: 'power2.out' },
                at + 0.03,
              );
            if (index < STEPS - 1)
              timeline.to(
                [`${part} .pc-part__text`, `${part} .pc-part__figure`],
                { autoAlpha: 0, y: -24, duration: 0.12, ease: 'power1.in' },
                at + PART_LENGTH - 0.14,
              );
          }
          const rows = (selector: string, at: number) =>
            timeline.fromTo(
              selector,
              { autoAlpha: 0, x: -12 },
              { autoAlpha: 1, x: 0, duration: 0.1, stagger: 0.07 },
              at,
            );

          // 1. One place: money (hidden), identity, agents.
          rows('.pc-home .pc-row', PARTS_AT + 0.15);

          // 2. Selective disclosure: an app asks, the hidden details are read into a proof, and only
          //    the answer lights up.
          const second = PARTS_AT + PART_LENGTH;
          timeline
            .fromTo(
              '.pc-ask',
              { autoAlpha: 0, y: 12, scale: 0.92, transformOrigin: '100% 100%' },
              { autoAlpha: 1, y: 0, scale: 1, duration: 0.12, ease: 'back.out(1.8)' },
              second + 0.12,
            )
            .fromTo(
              '.pc-id__scan',
              { autoAlpha: 1, top: '0%' },
              { top: '100%', duration: 0.2, ease: 'power1.inOut' },
              second + 0.24,
            )
            .to('.pc-id__scan', { autoAlpha: 0, duration: 0.04 }, second + 0.44)
            .fromTo(
              '.pc-id__proof',
              { '--lit': 0 },
              { '--lit': 1, duration: 0.12, ease: 'power2.out' },
              second + 0.44,
            );

          // 3. No seed phrase: a fingerprint is read; the seed phrase's words fold away.
          const third = PARTS_AT + 2 * PART_LENGTH;
          timeline.fromTo(
            '.pc-print path',
            { strokeDashoffset: 1 },
            { strokeDashoffset: 0, duration: 0.16, stagger: 0.025, ease: 'power1.inOut' },
            third + 0.08,
          );
          rows('.pc-unlock .pc-row', third + 0.26)
            .to(
              '.pc-seed__words i',
              {
                scaleX: 0,
                autoAlpha: 0,
                duration: 0.08,
                stagger: 0.015,
                transformOrigin: '100% 50%',
              },
              third + 0.42,
            )
            .fromTo(
              '.pc-seed strong',
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 0.08 },
              third + 0.5,
            );

          // 4. A name: the long address is struck through and the readable name is spelt out.
          const fourth = PARTS_AT + 3 * PART_LENGTH;
          timeline
            .fromTo(
              '.pc-name__strike',
              { scaleX: 0 },
              { scaleX: 1, duration: 0.1, transformOrigin: '0% 50%' },
              fourth + 0.16,
            )
            .fromTo('.pc-name__addr', { opacity: 1 }, { opacity: 0.4, duration: 0.1 }, fourth + 0.2)
            .fromTo(
              '.pc-name__letter',
              { autoAlpha: 0, y: 8 },
              { autoAlpha: 1, y: 0, duration: 0.05, stagger: 0.022 },
              fourth + 0.24,
            );

          // 5. Agents: what the pass allows, its cap, what it proves, then what it just did.
          const fifth = PARTS_AT + 4 * PART_LENGTH;
          rows('.pc-pass .pc-row', fifth + 0.18).to({}, { duration: 0.2 }, END_AT - 0.05);

          ScrollTrigger.refresh();
        }, section);
        revert = () => context.revert();
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      revert?.();
      revealAllowed.current = true;
    };
  }, [motion]);

  return (
    <section
      ref={sectionRef}
      className="journey"
      data-motion={motion ? 'on' : 'off'}
      aria-labelledby="landing-title"
    >
      {motion && <span ref={anchorRef} id="how-it-works" className="journey-anchor" />}
      <div className="journey-stage">
        <PorticoHero assets={HERO_ASSETS} onStart={onStart} revealAllowed={revealAllowed} />
        <PassportChapter anchorHere={!motion} />
      </div>
    </section>
  );
}
