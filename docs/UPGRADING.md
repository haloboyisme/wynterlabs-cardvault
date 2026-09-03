# Standalone upgrades

This repair is prepared for the next release. The immutable `v2.0.1` download
still contains the earlier broken upgrade helper; do not use that older helper.

When a newer release containing this repair is published:

1. Keep your original source checkout and escrowed secrets. Obtain the newer
   trusted release separately; never overwrite installation secrets.
2. From the **new release checkout**, run:

   ```sh
   sudo bash deploy/standalone/upgrade.sh
   ```

3. The helper requires a completed standalone installation and a strictly newer
   version. It takes a fresh backup, verifies checksums, and restores the database
   into a temporary PostgreSQL container before changing the active release.
4. It builds the new application, applies migrations, waits for service health,
   then updates the active release. Check sign-in and your collection afterward.

The preflight database has no network, host ports, shared production volumes, or
production credentials. Its anonymous volume is removed with the test container.
A failed backup/restore check stops the upgrade before application changes.

Application rollback is not a database downgrade. After a migration failure,
preserve the backup and use the documented isolated recovery procedure; do not
assume older code can safely run against every newer schema. This patch does
not change migration rollback behavior.

## Maintainer check

Only in a disposable clone of an older standalone installation:

```sh
sudo env CARDVAULT_DISPOSABLE_UPGRADE=YES bash deploy/standalone/tests/upgrade-smoke.sh
```

It runs the actual upgrade and checks target activation, unchanged user/card-row
counts, and API readiness. Never enable this test against a production server.

## Repair verification — 2026-09-03

- Reproduced the missing-verifier failure on a disposable clone, then verified
  the replacement performed a real isolated restore before upgrading.
- The older installation exposed a PostgreSQL enum transaction error while
  migrating from `0011_collection_value_history`. The role-text comparison
  repair allowed all migrations through `0018_account_community` to finish.
- Actual upgrade from 1.0.0 to the repaired 2.0.1 candidate succeeded, activated
  the new release, and left all four services healthy with API readiness 200.
- User/card-row counts were unchanged. This older fixture contained no users or
  collection entries, so this check is not a populated-collection retention test.
- Invalid backup input and missing disposable-test opt-in were rejected.
- Shell syntax, Python migration compilation, and diff checks passed. No full
  application test-suite rerun was needed for this focused installer repair.
- The disposable clone was removed afterward; the original test installation,
  live site, published V2 branch, and immutable release tags were not changed.
