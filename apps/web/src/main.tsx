import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/app';
import { AppProviders } from '@/app/providers';
import type { Auth } from '@/lib/auth/auth-context';
import { createMockAuth } from '@/lib/auth/mock-auth';
import { createMsalAuth, createMsalClient } from '@/lib/auth/msal-auth';
import { loadRuntimeConfig, type RuntimeConfig } from '@/lib/config';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');
const root = createRoot(container);

try {
  const config = await loadRuntimeConfig();
  const auth = await createAuth(config);
  root.render(
    <StrictMode>
      <AppProviders auth={auth}>
        <App />
      </AppProviders>
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
