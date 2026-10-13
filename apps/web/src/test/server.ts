import { setupServer } from 'msw/node';

/** Intercepts fetch in tests. Tests add handlers with server.use(...). */
export const server = setupServer();
