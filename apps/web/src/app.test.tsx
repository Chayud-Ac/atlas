import { screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { fakeAuth, renderApp } from './test/render.js';
import { problem, server } from './test/server.js';

describe('App', () => {
  it('asks a signed-out visitor to sign in', async () => {
    const auth = fakeAuth({ isSignedIn: false });
    const { user } = renderApp(auth);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it('shows the signed-in user from /api/users/me', async () => {
    renderApp();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('signs out', async () => {
    const auth = fakeAuth();
    const { user } = renderApp(auth);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('starts sign-in again when the API rejects the token', async () => {
    server.use(http.get('/api/users/me', () => problem({ status: 401, title: 'Unauthorized' })));
    const auth = fakeAuth();
    renderApp(auth);

    await waitFor(() => {
      expect(auth.signIn).toHaveBeenCalledOnce();
    });
  });
});
