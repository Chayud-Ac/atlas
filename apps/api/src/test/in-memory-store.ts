import { v7 as uuidv7 } from 'uuid';
import type { User, UsersRepository } from '../users/user.js';

/** In-memory test doubles for the repositories. Unit tests only; Postgres is tested separately. */
export function createInMemoryStore() {
  const users = new Map<string, User>();

  const usersRepository: UsersRepository = {
    upsertFromIdentity(identity) {
      const key = `${identity.entraTenantId}/${identity.entraObjectId}`;
      const user: User = { id: users.get(key)?.id ?? uuidv7(), ...identity };
      users.set(key, user);
      return Promise.resolve(user);
    },
  };

  return { users: usersRepository, allUsers: () => [...users.values()] };
}

export type InMemoryStore = ReturnType<typeof createInMemoryStore>;
