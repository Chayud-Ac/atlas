import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/database.js';
import { users } from '../db/schema.js';

/** The app's own record of a person. `id` is ours; the Entra ids are only used to find it. */
export interface User {
  id: string;
  entraTenantId: string;
  entraObjectId: string;
  email: string | null;
  displayName: string | null;
}

/** What a validated token tells us about the caller. */
export interface UserIdentity {
  entraTenantId: string;
  entraObjectId: string;
  email: string | null;
  displayName: string | null;
}

export interface UsersRepository {
  /** Creates the user on first sign-in; afterwards refreshes profile fields and last_seen_at. */
  upsertFromIdentity(identity: UserIdentity): Promise<User>;
}

export function createPgUsersRepository(db: Executor): UsersRepository {
  return {
    async upsertFromIdentity(identity) {
      const [upserted] = await db
        .insert(users)
        .values({ ...identity, lastSeenAt: sql`now()` })
        .onConflictDoUpdate({
          target: [users.entraTenantId, users.entraObjectId],
          set: {
            email: sql`excluded.email`,
            displayName: sql`excluded.display_name`,
            lastSeenAt: sql`now()`,
            updatedAt: sql`now()`,
          },
          // This runs on every request: skip the write unless something changed or
          // last_seen_at is more than 5 minutes old (spec §8.2).
          setWhere: sql`${users.lastSeenAt} < now() - interval '5 minutes'
            OR ${users.email} IS DISTINCT FROM excluded.email
            OR ${users.displayName} IS DISTINCT FROM excluded.display_name`,
        })
        .returning();
      return toUser(upserted ?? (await findByIdentity(db, identity)));
    },
  };
}

async function findByIdentity(
  db: Executor,
  identity: UserIdentity,
): Promise<typeof users.$inferSelect> {
  const [row] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.entraTenantId, identity.entraTenantId),
        eq(users.entraObjectId, identity.entraObjectId),
      ),
    );
  if (!row) throw new Error('User row missing right after upsert');
  return row;
}

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    entraTenantId: row.entraTenantId,
    entraObjectId: row.entraObjectId,
    email: row.email,
    displayName: row.displayName,
  };
}
