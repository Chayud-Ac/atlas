import { describe, expect, it } from 'vitest';
import { APP_TABLE_GRANTS, grantStatements } from './migrations.js';

describe('grantStatements', () => {
  it('re-applies the allowlist from scratch for the role', () => {
    expect(grantStatements('atlas_app')).toEqual([
      'GRANT USAGE ON SCHEMA app TO "atlas_app"',
      'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM "atlas_app"',
      'GRANT SELECT, INSERT, UPDATE ON app.users TO "atlas_app"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON app.notes TO "atlas_app"',
      'GRANT SELECT, INSERT ON app.audit_events TO "atlas_app"',
    ]);
  });

  it('keeps audit_events append-only', () => {
    expect(APP_TABLE_GRANTS.audit_events).toEqual(['SELECT', 'INSERT']);
  });

  it('refuses role names that could inject SQL', () => {
    expect(() => grantStatements('x" TO PUBLIC; --')).toThrow(/Unsafe/);
  });
});
