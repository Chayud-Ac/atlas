/** Postgres role names Atlas will grant to: letters, digits, `_` and `-`, at most 63 bytes. */
export const ROLE_NAME = /^[A-Za-z0-9_-]{1,63}$/;
