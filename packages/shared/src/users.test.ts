import { describe, expect, it } from 'vitest';
import { CurrentUser } from './users.js';

describe('CurrentUser', () => {
  const user = {
    id: '0199c3a0-0000-7000-8000-000000000001',
    displayName: 'Chayud M.',
    email: 'someone@example.com',
    roles: ['Admin'],
  };

  it('accepts a user as GET /api/me returns it', () => {
    expect(CurrentUser.parse(user)).toEqual(user);
  });

  it('accepts a user whose name and email are unknown', () => {
    const anonymous = { ...user, displayName: null, email: null };
    expect(CurrentUser.parse(anonymous)).toEqual(anonymous);
  });

  it('accepts a user with no roles', () => {
    expect(CurrentUser.parse({ ...user, roles: [] }).roles).toEqual([]);
  });

  it('rejects a response without roles, so "no roles" is never ambiguous', () => {
    const { roles: _roles, ...withoutRoles } = user;
    expect(CurrentUser.safeParse(withoutRoles).success).toBe(false);
  });

  it('rejects an empty role name', () => {
    expect(CurrentUser.safeParse({ ...user, roles: [''] }).success).toBe(false);
  });

  it('rejects an id that is not a UUID', () => {
    expect(CurrentUser.safeParse({ ...user, id: 'abc' }).success).toBe(false);
  });

  it('rejects unknown fields, so internal identifiers cannot leak to the browser', () => {
    const leaky = { ...user, entraObjectId: '0199c3a0-0000-7000-8000-000000000002' };
    expect(CurrentUser.safeParse(leaky).success).toBe(false);
  });
});
