import { lazy, Suspense, useEffect, useState } from 'react';
import { LandingPage } from './components/landing/LandingPage';
import './styles/runtime-loading.css';

const PollWorkspace = lazy(() => import('./views/PollWorkspace'));
const DocsPage = lazy(() => import('./views/DocsPage'));
const FeedbackPage = lazy(() => import('./views/FeedbackPage'));
const isWorkspace = () =>
  window.location.pathname.replace(/\/$/, '') === '/passport-callback' ||
  ['#polls', '#organizer', '#verify', '#connect', '#poll-main'].includes(window.location.hash);

export function RestartApp() {
  const [workspace, setWorkspace] = useState(isWorkspace);
  useEffect(() => {
    const sync = () => setWorkspace(isWorkspace());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const pathname = window.location.pathname.replace(/\/$/, '');
  if (pathname === '/docs')
    return (
      <Suspense fallback={<main>Loading documentation…</main>}>
        <DocsPage />
      </Suspense>
    );
  if (pathname === '/feedback')
    return (
      <Suspense fallback={<main>Loading feedback…</main>}>
        <FeedbackPage />
      </Suspense>
    );
  if (!workspace) return <LandingPage />;
  return (
    <Suspense fallback={<main className="runtime-loading">Preparing the poll workspace…</main>}>
      <PollWorkspace />
    </Suspense>
  );
}
