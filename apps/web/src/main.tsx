import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { registerServiceWorker } from './platform/registerServiceWorker';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After render, and a no-op in development and in any browser without support. The editor must
// behave identically with no service worker — see ./platform/registerServiceWorker.ts.
registerServiceWorker();
