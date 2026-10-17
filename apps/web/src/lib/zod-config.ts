import { z } from 'zod';

// The CSP forbids eval (ADR 0016). Without this, zod tries `new Function('')` once to find out
// whether it may compile faster parsers, and the browser reports a CSP violation. zod reads the
// setting when each schema is created, so main.tsx imports this file before anything else.
z.config({ jitless: true });
