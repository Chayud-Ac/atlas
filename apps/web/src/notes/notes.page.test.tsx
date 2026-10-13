import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render.js';
import { makeNote, notesDb, problem, server } from '../test/server.js';

describe('NotesPage', () => {
  it('lists your notes in the order the API returns them', async () => {
    notesDb.push(makeNote({ title: 'Newer' }), makeNote({ title: 'Older' }));
    renderApp();

    const list = await screen.findByRole('list', { name: 'Notes' });

    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Newer'),
      expect.stringContaining('Older'),
    ]);
  });

  it('says so when there are no notes', async () => {
    renderApp();
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
  });

  it('checks the form with the shared schema before calling the API', async () => {
    let posted = false;
    server.use(
      http.post('/api/notes', () => {
        posted = true;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const { user } = renderApp();
    await screen.findByText('No notes yet.');

    await user.type(screen.getByRole('textbox', { name: /Title/ }), '   ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('creates a note and clears the form', async () => {
    const { user } = renderApp();
    await screen.findByText('No notes yet.');

    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Buy milk');
    await user.type(screen.getByRole('textbox', { name: 'Body' }), 'Two litres');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByText('Two litres')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('');
  });

  it('shows field errors returned by the API', async () => {
    server.use(
      http.post('/api/notes', () =>
        problem({
          status: 400,
          title: 'Bad Request',
          detail: 'Request validation failed.',
          errors: [{ path: 'title', message: 'Title is already used' }],
        }),
      ),
    );
    const { user } = renderApp();
    await screen.findByText('No notes yet.');

    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Duplicate');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Title is already used')).toBeInTheDocument();
  });

  it('deletes a note', async () => {
    notesDb.push(makeNote({ title: 'Old idea' }));
    const { user } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Delete Old idea' }));

    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
  });

  it('shows the request id when loading fails', async () => {
    server.use(
      http.get('/api/notes', () =>
        problem({ status: 403, title: 'Forbidden', requestId: 'req-42' }),
      ),
    );
    renderApp();
    expect(await screen.findByText(/reference req-42/)).toBeInTheDocument();
  });
});
