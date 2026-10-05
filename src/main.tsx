import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installBrowserIpcFallback } from './utils/browserIpcFallback.ts';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement);
async function renderApp() {
  try {
    installBrowserIpcFallback();
    // Load bundled faces before the first paint so text never swaps from fallback.
    await Promise.allSettled([...document.fonts].map((font) => font.load()));
    root.render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </React.StrictMode>,
    );
  } catch (error) {
    console.error(error);
    root.render(
      <main role="alert" className="p-12 text-pro-text-main">
        <h1 className="mb-4 text-2xl">Pluto couldn’t connect to your data</h1>
        <p className="mb-4">
          The desktop connection failed to load. Reload Pluto to reconnect.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Pluto
        </button>
      </main>,
    );
  }
}

void renderApp();

// Use contextBridge
window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message);
});
