import { z } from 'zod';

/**
 * The access-token claims Atlas relies on; everything else in the token is ignored.
 * `oid`/`tid` use z.guid(): Entra GUIDs aren't guaranteed to carry RFC 9562 version bits.
 */
export const AccessTokenClaims = z.object({
  oid: z.guid(),
  tid: z.guid(),
  scp: z.string().optional(),
  roles: z.array(z.string()).optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  preferred_username: z.string().optional(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;
