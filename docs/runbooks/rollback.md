# Roll back a deploy

When a deploy broke something, redeploy the last good image. Nothing is rebuilt: every image pushed since M5 is still in the registry, tagged with its commit SHA.

1. **Find the last good SHA.** Prod releases are tagged `prod-<date>-<short sha>`:

   ```bash
   gh release list --limit 5
   git rev-parse <short sha>    # the full SHA: images are tagged with all 40 characters
   ```

2. **Clear stale approvals.** A run waiting for UAT or prod approval holds that environment's deploy lock, and the rollback would queue behind it. Open each waiting run (`gh run list --workflow deploy.yml`), then **Review deployments → Reject**.
3. **Run the rollback:**

   ```bash
   gh workflow run deploy.yml -f sha=<full sha>
   ```

   It skips CI and the build, deploys dev, then waits for the UAT and prod approvals as usual. Approve both, even for a prod-only problem: the same SHA goes through every stage.

4. **Check it.** Each stage's smoke tests check the version. By hand:

   ```bash
   curl -s https://<web fqdn>/api/health/live | jq .version
   ```

## Migrations

A rollback never undoes a migration. The older image's migration job runs its own, older migrations, which are already applied, so nothing changes. That's safe because every migration is expand-then-contract (ADR 0006): the previous app version works with the current schema.

If the migration itself was wrong, fix forward: a new migration in a new pull request.
