import { lazy, Suspense, useEffect, useState } from 'react';
import { LandingPage } from './components/landing/LandingPage';

const FeedbackPage = lazy(() => import('./views/FeedbackPage'));
const DocsPage = lazy(() => import('./views/DocsPage'));

const CivicRuntime = lazy(async () => {
  const module = await import('./CivicRuntime');
  return { default: module.CivicRuntime };
});

/**
 * The app, or the one screen inside it that has an address of its own. The
 * two addresses are repeated here so that the landing page does not load the
 * runtime of the app to read them.
 */
function isAppHash(hash: string): boolean {
  return hash === '#app' || hash === '#app/pulse';
}

export function App() {
  const [inApp, setInApp] = useState(
    () => isAppHash(window.location.hash) || window.parent !== window,
  );
  useEffect(() => {
    const syncRoute = () => {
      const next = isAppHash(window.location.hash) || window.parent !== window;
      setInApp(next);
      if (next !== inApp) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, [inApp]);
  if (window.location.pathname.replace(/\/$/, '') === '/docs') {
    return (
      <Suspense fallback={<main className="runtime-loading">Loading documentation…</main>}>
        <DocsPage />
      </Suspense>
    );
  }
  if (window.location.pathname.replace(/\/$/, '') === '/feedback') {
    return (
      <Suspense fallback={<main className="runtime-loading">Loading…</main>}>
        <FeedbackPage />
      </Suspense>
    );
  }
  if (!inApp) return <LandingPage />;
  return (
    <Suspense
      fallback={
        <main className="runtime-loading" aria-live="polite">
          <div className="runtime-loading__symbol" aria-hidden="true">
            <img src="/brand/midnight-vote-d3-white.svg" alt="" />
          </div>
          <p>A little privacy. A new possibility.</p>
          <small>Preparing your experience…</small>
        </main>
      }
    >
      <CivicRuntime />
    </Suspense>
  );
}
