import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { type CicoLocale, detectLocale } from '@/integration/locale';
import { FeedbackForm } from './FeedbackForm';
import './poll-workspace.css';

/** Help and feedback, in the workspace's paper: the same header, one card, one terracotta action. */
export default function FeedbackPage() {
  const [locale, setLocale] = useState<CicoLocale>(() => detectLocale());
  const t = {
    en: [
      'Help and feedback',
      'Tell us where you got stuck or what would make this experience clearer.',
      'Back to midnight.vote',
      'Try a poll',
    ],
    es: [
      'Ayuda y feedback',
      'Contanos dónde te trabaste o qué haría más clara esta experiencia.',
      'Volver a midnight.vote',
      'Probar una encuesta',
    ],
    fr: [
      'Aide et retours',
      'Dites-nous ce qui rendrait cette expérience plus claire.',
      'Retour à midnight.vote',
      'Essayer un sondage',
    ],
  }[locale];
  const title = t[0];
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `midnight.vote — ${title}`;
  }, [locale, title]);
  return (
    <div className="poll-workspace feedback-shell">
      <div className="app-header-wrap">
        <header className="app-header">
          <a href="/" className="app-brand" aria-label="midnight.vote home">
            <img src="/brand/midnight-vote-d3-black.svg" width="40" height="23" alt="" />
            <span>
              midnight<span className="app-brand__suffix">.vote</span>
            </span>
          </a>
          <select
            className="feedback-lang"
            aria-label="Language"
            value={locale}
            onChange={(event) => setLocale(event.target.value as CicoLocale)}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
          </select>
          <a className="app-passport" href="/#polls">
            {t[3]} <ArrowUpRight className="app-arrow" size={16} weight="bold" />
          </a>
        </header>
      </div>
      <main className="feedback-page">
        <a href="/" className="app-back">
          <ArrowLeft size={16} weight="bold" /> {t[2]}
        </a>
        <h1>{t[0]}</h1>
        <p className="app-lead">{t[1]}</p>
        <FeedbackForm locale={locale} />
      </main>
    </div>
  );
}
