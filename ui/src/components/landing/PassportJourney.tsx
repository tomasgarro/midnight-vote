import { useEffect, useRef, useState } from 'react';
import { HERO_ASSETS } from './hero-assets';
import { MARK_UNITS, SQUARE_CENTRES_Y } from './MidnightMark';
import { PassportChapter } from './PassportChapter';
import { PorticoHero } from './PorticoHero';
import './portico-hero.css';
import './passport-chapter.css';
import { loadScroll, SCROLL_SCENES, useMediaQuery } from './scroll';

/** Where the symbol rests while the three parts play, as fractions of the stage. */
const COLUMN_X = 0.27;
const MARK_Y = 0.27;
/** Positions inside the part cards, in symbol widths (`--m`). They match passport-chapter.css. */
const FIGURE_LEFT = -1.5;
const FIGURE_TOP = 0.72;
const POLL_BULLET_X = 0.247;
const POLL_FIRST_BULLET_Y = 1.03;
const POLL_ROW = 0.42;
const SEAL = { x: 2.5, y: 0.52, scale: 0.42 };
/** Timeline positions, in screens of scrolling. */
const PHRASE_AT = 1.3;
const PARTS_AT = 2.2;
const PART_LENGTH = 0.8;

/**
 * The hero and the chapter share one pinned stage, so the symbol on the passport cover is the
 * same symbol that then carries the three parts. Without room or motion, the same content is a
 * plain page.
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
          const wrap = section.querySelector<HTMLElement>('.ph-hand-wrap');
          const hand = section.querySelector<HTMLElement>('.hero-hand');
          const markBox = section.querySelector<HTMLElement>('.pc-mark');
          const mark = markBox?.querySelector<SVGSVGElement>('svg');
          if (!stage || !wrap || !hand || !markBox || !mark) return;
          const squares = [...mark.querySelectorAll<SVGRectElement>('.midnight-mark__square')];
          const { symbol, coverReach } = HERO_ASSETS;

          const W = () => stage.clientWidth;
          const H = () => stage.clientHeight;
          const m = () => markBox.offsetWidth;
          const logoX = () => wrap.offsetLeft + hand.offsetLeft + symbol.x * hand.offsetWidth;
          const logoY = () => wrap.offsetTop + hand.offsetTop + symbol.y * hand.offsetHeight;
          /** Enough zoom for the cover to fill the stage around the symbol. */
          const zoom = () =>
            Math.max(
              W() / 2 / (coverReach.x * hand.offsetWidth),
              H() / 2 / (coverReach.y * hand.offsetHeight),
            ) * 1.08;
          const zoomedMark = () => (symbol.size * hand.offsetWidth * zoom()) / m();

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
              scrub: 0.5,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                revealAllowed.current = self.progress < 0.004;
              },
              onRefresh: (self) => {
                const anchor = anchorRef.current;
                if (anchor)
                  anchor.style.top = `${((PHRASE_AT + 0.55) / timeline.duration()) * (self.end - self.start)}px`;
              },
            },
          });

          // The opening: through the columns, into the cover.
          timeline
            .to('.ph-copy', { autoAlpha: 0, y: -40, duration: 0.25, ease: 'power1.in' }, 0)
            .to('.ph-columns', { scale: 2.6, duration: 0.8, ease: 'power1.in' }, 0)
            .to('.ph-columns', { autoAlpha: 0, duration: 0.18 }, 0.6)
            .to('.ph-sky', { scale: 1.2, duration: 1.2 }, 0)
            .to(
              hand,
              {
                scale: zoom,
                x: () => W() / 2 - logoX(),
                y: () => H() / 2 - logoY(),
                duration: 1,
                ease: 'power2.in',
              },
              0.12,
            )
            .to(hand, { '--cover-flat': 1, duration: 0.55 }, 0.5)
            .fromTo(
              '.hero-hand__symbol--zoom',
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 0.1 },
              0.66,
            )
            .to('.hero-hand__shade', { opacity: 1, duration: 0.26, ease: 'power1.in' }, 0.86)
            .fromTo(markBox, { autoAlpha: 0, x: 0, y: 0 }, { autoAlpha: 1, duration: 0.03 }, 1.12)
            .fromTo(mark, { scale: zoomedMark }, { scale: zoomedMark, duration: 0.01 }, 1.12)
            .fromTo('.pc-ground', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06 }, 1.13)
            .set('.ph', { autoAlpha: 0 }, 1.2);

          // The phrase, under the symbol.
          timeline
            .to(mark, { scale: 1.65, duration: 0.35, ease: 'power2.inOut' }, PHRASE_AT)
            .to(markBox, { y: () => -0.14 * H(), duration: 0.35, ease: 'power2.inOut' }, PHRASE_AT)
            .fromTo(
              '.pc-word',
              { autoAlpha: 0, y: 14 },
              { autoAlpha: 1, y: 0, duration: 0.12, stagger: 0.035 },
              PHRASE_AT + 0.18,
            )
            .to('.pc-phrase', { autoAlpha: 0, y: -24, duration: 0.15 }, PARTS_AT - 0.25)
            .to(
              '.pc-ground',
              { clipPath: 'inset(14px 14px 14px 14px round 32px)', duration: 0.2 },
              PARTS_AT - 0.25,
            )
            .to(
              markBox,
              {
                x: () => (COLUMN_X - 0.5) * W(),
                y: () => (MARK_Y - 0.5) * H(),
                duration: 0.3,
                ease: 'power2.inOut',
              },
              PARTS_AT - 0.2,
            )
            .to(mark, { scale: 1, duration: 0.3, ease: 'power2.inOut' }, PARTS_AT - 0.2);

          // The three parts.
          for (const index of [0, 1, 2] as const) {
            const at = PARTS_AT + index * PART_LENGTH;
            const part = `.pc-part--${index + 1}`;
            timeline
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
            if (index < 2)
              timeline.to(
                [`${part} .pc-part__text`, `${part} .pc-part__figure`],
                { autoAlpha: 0, y: -24, duration: 0.12, ease: 'power1.in' },
                at + PART_LENGTH - 0.14,
              );
          }

          // 1. The proven line lights up; the others stay covered.
          const first = PARTS_AT;
          timeline.fromTo(
            '.pc-id__proof',
            { '--lit': 0 },
            { '--lit': 1, duration: 0.15, ease: 'power2.out' },
            first + 0.25,
          );

          // 2. The three squares leave the ring and become the poll's rules.
          const second = PARTS_AT + PART_LENGTH;
          squares.forEach((square, index) => {
            const centreY = SQUARE_CENTRES_Y[index] ?? 0;
            const toY =
              FIGURE_TOP +
              POLL_FIRST_BULLET_Y +
              index * POLL_ROW -
              (centreY - 394.685) / MARK_UNITS;
            const toX = FIGURE_LEFT + POLL_BULLET_X;
            timeline
              .to(
                square,
                {
                  x: toX * MARK_UNITS,
                  y: toY * MARK_UNITS,
                  color: '#a24f40',
                  duration: 0.2,
                  ease: 'power2.inOut',
                },
                second + 0.12 + index * 0.04,
              )
              .to(
                square,
                { x: 0, y: 0, color: '#fbf8f1', duration: 0.16, ease: 'power2.inOut' },
                second + PART_LENGTH - 0.16,
              );
          });
          timeline.fromTo(
            '.pc-poll__rule',
            { autoAlpha: 0, x: -10 },
            { autoAlpha: 1, x: 0, duration: 0.1, stagger: 0.05 },
            second + 0.3,
          );

          // 3. The symbol comes down on the receipt as its seal.
          const third = PARTS_AT + 2 * PART_LENGTH;
          timeline
            .to(
              mark,
              {
                x: () => (FIGURE_LEFT + SEAL.x) * m(),
                y: () => (FIGURE_TOP + SEAL.y) * m(),
                scale: SEAL.scale * 1.25,
                duration: 0.22,
                ease: 'power2.inOut',
              },
              third + 0.12,
            )
            .to(
              mark,
              { scale: SEAL.scale, color: '#a24f40', duration: 0.05, ease: 'power3.in' },
              third + 0.34,
            )
            .to(squares, { color: '#a24f40', duration: 0.05 }, third + 0.34)
            .fromTo(
              '.pc-receipt__counted',
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 0.1 },
              third + 0.4,
            )
            .to({}, { duration: 0.25 }, third + PART_LENGTH - 0.25);

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
