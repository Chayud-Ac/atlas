import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { notesDb, server } from './server.js';

// jsdom does no layout, so it has no ResizeObserver. Fluent's MessageBar uses one to pick its layout.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {
      // nothing to observe without layout
    }
    unobserve() {
      // nothing to observe without layout
    }
    disconnect() {
      // nothing to observe without layout
    }
  },
);

// A request without a handler fails the test instead of reaching the network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  notesDb.length = 0;
  sessionStorage.clear();
});

afterAll(() => {
  server.close();
});
