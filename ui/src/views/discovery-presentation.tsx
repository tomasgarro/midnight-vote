import {
  Buildings,
  DeviceMobile,
  GlobeHemisphereWest,
  Leaf,
  type Icon as PhosphorIcon,
  PiggyBank,
  Scales,
  Shield,
  Sparkle,
  Train,
  Users,
} from '@phosphor-icons/react';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import type { CicoLocale } from '@/integration/locale';
import { type Poll, pollCountryCode } from './poll-model';

export const SUBJECTS = {
  en: {
    all: 'All subjects',
    mobility: 'Transport',
    housing: 'Housing',
    climate: 'Nature & climate',
    governance: 'Civic life',
    economy: 'Economy',
  },
  es: {
    all: 'Todos los temas',
    mobility: 'Transporte',
    housing: 'Vivienda',
    climate: 'Naturaleza y clima',
    governance: 'Vida cívica',
    economy: 'Economía',
  },
  fr: {
    all: 'Tous les sujets',
    mobility: 'Transports',
    housing: 'Logement',
    climate: 'Nature et climat',
    governance: 'Vie civique',
    economy: 'Économie',
  },
};
export function pollSubject(poll: Poll): NonNullable<Poll['subject']> {
  return (
    poll.subject ??
    (poll.id === 'france-mobilite'
      ? 'mobility'
      : poll.id === 'energia-renovable'
        ? 'climate'
        : 'economy')
  );
}
export function canUseDemoPass(
  poll: Poll,
  credential: DemoCredentialSummary | null,
  now = new Date(),
): boolean {
  return Boolean(
    credential?.kind === 'synthetic-demo-credential' &&
      credential.ageClass === '18+' &&
      Date.parse(credential.validUntil) > now.getTime() &&
      (!pollCountryCode(poll) || pollCountryCode(poll) === credential.country),
  );
}
/** A line icon names the subject. It is not card art, which waits for approval. */
const SUBJECT_ICONS: Readonly<Record<string, PhosphorIcon>> = {
  'world-social-media-age': DeviceMobile,
  'ch-ahv-vat': PiggyBank,
  'ch-war-materiel': Shield,
  'ch-married-couples-tax': Users,
  'ch-fireworks': Sparkle,
};
const DEFAULT_ICONS: Readonly<Record<NonNullable<Poll['subject']>, PhosphorIcon>> = {
  mobility: Train,
  housing: Buildings,
  climate: Leaf,
  governance: GlobeHemisphereWest,
  economy: Scales,
};
export function ConsultationMedia({ poll, locale }: { poll: Poll; locale: CicoLocale }) {
  const subject = pollSubject(poll);
  const Icon = SUBJECT_ICONS[poll.id] ?? DEFAULT_ICONS[subject];
  return (
    <div className={`poll-media poll-media--${subject}`}>
      {poll.media?.video ? (
        <video
          controls
          playsInline
          preload="none"
          poster={poll.media.image}
          aria-label={poll.title}
        >
          <source src={poll.media.video} />
          <track
            kind="captions"
            src={poll.media.captions}
            srcLang={locale}
            label={locale}
            default
          />
        </video>
      ) : poll.media?.image ? (
        <img src={poll.media.image} alt="" loading="lazy" />
      ) : (
        <Icon size={78} weight="duotone" aria-hidden="true" />
      )}
      <span>{SUBJECTS[locale][subject]}</span>
    </div>
  );
}
