import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import type { Auth } from './auth/auth.js';
import { createMockAuth } from './auth/mock-auth.js';
import { createMsalAuth, createMsalClient } from './auth/msal-auth.js';
import { loadRuntimeConfig, type RuntimeConfig } from './config.js';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');
const root = createRoot(container);

try {
  const config = await loadRuntimeConfig();
  const auth = await createAuth(config);
  root.render(
    <StrictMode>
      <App auth={auth} />
    </StrictMode>,
  );
} catch (error) {
  console.error(error);
  root.render(<p role="alert">Atlas could not start. See the browser console for details.</p>);
}

async function createAuth({ auth }: RuntimeConfig): Promise<Auth> {
  if (auth.kind === 'mock') return createMockAuth(auth);
  return createMsalAuth(await createMsalClient(auth), auth.apiScope);
}
