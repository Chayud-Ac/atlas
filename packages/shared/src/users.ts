import { z } from 'zod';

/**
 * The signed-in user, as returned by GET /api/users/me.
 * `id` is the app's own users.id, never an Entra identifier. `roles` comes from the
 * token's `roles` claim (Entra App Roles) and is always present, even when empty.
 */
export const CurrentUser = z.strictObject({
  id: z.uuid(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  roles: z.array(z.string().min(1)),
});
export type CurrentUser = z.infer<typeof CurrentUser>;
