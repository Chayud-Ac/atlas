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
