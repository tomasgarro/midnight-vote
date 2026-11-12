import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RestartApp } from './RestartApp';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
if (
  import.meta.env.VITE_INCLUDE_LEGACY === 'true' &&
  (location.hash === '#app' || location.hash === '#app/pulse')
) {
  location.replace(`/legacy.html${location.hash}`);
} else {
  createRoot(root).render(
    <StrictMode>
      <RestartApp />
    </StrictMode>,
  );
}
