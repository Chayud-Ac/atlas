# Database access

| Environment | Who                   | How                                               |
| ----------- | --------------------- | ------------------------------------------------- |
| dev         | `atlas-dev-db-admins` | `scripts/db-access.sh dev`, then `psql` (below)   |
| uat, prod   | nobody                | reviewed migrations, emergencies included (below) |

## Dev

```bash
scripts/db-access.sh dev            # opens the firewall to your IP and prints the psql command
# ... psql as atlas-dev-db-admins, with an Entra token as the password ...
scripts/db-access.sh dev --revoke   # closes it again
```

You connect as an Entra admin of the server. Keep it to reading. Data changes ship as migrations, so they reach UAT and prod the same way.

## UAT and prod

Their databases have no public endpoint (ADR 0008), so nothing outside the VNet can connect, and nobody is in `atlas-uat-db-admins` or `atlas-prod-db-admins`.

- **A data fix:** a migration in a pull request. It's reviewed, it runs in dev first, then UAT and prod after approval, and the PR and the deploy run record every step.
- **An emergency:** the same path. About 10 minutes for CI and the dev deploy, then the two approvals.
- **Looking into a problem:** start with Application Insights (`appi-atlas-<env>`: requests, dependencies with their SQL, exceptions) and the Postgres log in `log-atlas-<env>` (`AzureDiagnostics`).
