import { useEffect } from 'react';
import { persistLocale } from '@/integration/locale';
import { LandingEnd } from './Closeout';
import { LandingHeader } from './LandingHeader';
import { PassportJourney } from './PassportJourney';
import './landing.css';
import './landing-actions.css';

/**
 * The landing page, in four movements: the hand between the columns, the passport's black with
 * what midnight.vote does, two doors, and the Geneva harbour.
 */
export function LandingPage() {
  useEffect(() => {
    document.documentElement.lang = 'en';
    document.title = 'midnight.vote — Your voice. Your choice. Your secret.';
  }, []);
  const open = (place: 'polls' | 'organizer') => {
    persistLocale('en');
    window.location.hash = place;
  };
  const start = () => open('polls');
  const organise = () => open('organizer');
  return (
    <div className="civic-landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <LandingHeader onStart={start} />
      <main id="landing-main">
        <PassportJourney onStart={start} />
        <LandingEnd onStart={start} onOrganise={organise} />
      </main>
    </div>
  );
}
