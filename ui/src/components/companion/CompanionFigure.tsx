import {
  BookOpenText,
  HandWaving,
  Hourglass,
  type Icon,
  IdentificationCard,
  SealCheck,
  ShieldCheck,
} from '@phosphor-icons/react';
import bustSrc from '@/assets/companion/cleisthenes-bust.webp';
import './companion-figure.css';

/**
 * What the companion is doing. The names are the ones the capybara had, so
 * every screen that showed a pose shows the same pose now.
 */
export type CompanionPose = 'welcome' | 'explain' | 'passport' | 'waiting' | 'success' | 'reassure';

const POSE_BADGE: Record<CompanionPose, Icon> = {
  welcome: HandWaving,
  explain: BookOpenText,
  passport: IdentificationCard,
  waiting: Hourglass,
  success: SealCheck,
  reassure: ShieldCheck,
};

export interface CompanionFigureProps {
  readonly pose: CompanionPose;
  /** Lets the figure arrive with a short movement. Off by default. */
  readonly motion?: boolean;
  /** For the one figure that is on screen when the page opens. */
  readonly priority?: boolean;
}

/**
 * Cleisthenes, the companion of midnight.vote.
 *
 * One approved bust, and a small badge that says what he is doing. A guide is
 * recognised by its face, so the face never changes; drawn poses replace the
 * badge once a pose sheet is approved.
 *
 * The figure is decorative and hidden from screen readers. It never appears
 * on a consent, eligibility or ballot screen: a friendly face beside a
 * decision is a nudge.
 */
export function CompanionFigure({ pose, motion = false, priority = false }: CompanionFigureProps) {
  const Badge = POSE_BADGE[pose];
  return (
    <span
      className="onboarding-mascot companion-figure"
      data-pose={pose}
      data-motion={motion}
      aria-hidden="true"
    >
      <span className="companion-figure__frame onboarding-mascot__image">
        <img
          className="companion-figure__bust"
          src={bustSrc}
          alt=""
          width="640"
          height="640"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          draggable={false}
        />
      </span>
      <span className="companion-figure__badge">
        <Badge weight="duotone" />
      </span>
    </span>
  );
}
