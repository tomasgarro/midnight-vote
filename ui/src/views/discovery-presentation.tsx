import {
  Buildings,
  CurrencyBtc,
  Drop,
  GlobeHemisphereWest,
  Leaf,
  Scales,
  Train,
  Wrench,
} from '@phosphor-icons/react';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
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
      : poll.id === 'reglas-de-verificacion'
        ? 'governance'
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
/**
 * The subject as a small tile beside the meta line. It was a 180px tinted
 * block in its own palette: civic topics rarely have an honest picture, and
 * the block pushed the question and the action below the fold.
 */
export function ConsultationMedia({ poll }: { poll: Poll }) {
  const subject = pollSubject(poll);
  const Icon =
    poll.id === 'switzerland-bitcoin'
      ? CurrencyBtc
      : poll.id === 'global-repair'
        ? Wrench
        : poll.id === 'spain-water-data'
          ? Drop
          : {
              mobility: Train,
              housing: Buildings,
              climate: Leaf,
              governance: GlobeHemisphereWest,
              economy: Scales,
            }[subject];
  return (
    <div className={`poll-media poll-media--${subject}`} aria-hidden="true">
      {poll.media?.image ? (
        <img src={poll.media.image} alt="" loading="lazy" />
      ) : (
        <Icon size={26} weight="duotone" />
      )}
    </div>
  );
}
