-- Local development only (docker compose). Mirrors the cloud split in spec §8.4:
-- atlas_migrator owns the schema; atlas_app may only read and write rows.
-- Throwaway local passwords: the cloud uses Entra tokens and has no passwords at all.
CREATE ROLE atlas_migrator LOGIN PASSWORD 'atlas_migrator';
CREATE ROLE atlas_app LOGIN PASSWORD 'atlas_app';
GRANT CONNECT, CREATE ON DATABASE atlas TO atlas_migrator;
GRANT CONNECT ON DATABASE atlas TO atlas_app;
