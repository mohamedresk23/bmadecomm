# Catalog public-copy withdrawal (A1)

Catalog images remain private. Every retained `product_media` relationship counts as ownership, including removed attachments, shared attachments and archived products. Neither generic publication nor selecting catalog media as a store logo is supported. Product publication remains metadata-only.

## Offline rollout

This implementation has been exercised only against disposable fixtures. No migration, deployment, CDN purge or persistent-data reconciliation has been performed.

Before an operational run, back up the database and deployment media storage. Stop all application instances and other writers; stop serving the old static `public/uploads` directory while reconciliation runs. Use the database snapshot and storage root belonging to the same deployment. Restrict access to the recovery directory and include it in private backups. Do not map `storage` or the deployment root to a public web directory.

Run with the intended `DATABASE_URL` already configured in the process environment (the command does not load environment files). Always supply the absolute deployment root containing `public/uploads` and `storage/private`:

```powershell
npx.cmd tsx scripts/reconcile-catalog-public-media.ts --storage-root 'C:\deployment\app'
```

The default is read-only inventory. Its JSON report lists each deduplicated catalog filename as `absent`, `exposed`, `conflict` or `failed`, including SHA-256 and byte count for existing copies. Keys are restricted to at most 255 characters and the existing jpg/png/webp key alphabet. Invalid keys and unreadable objects are failures. No product or media status is changed.

The selected root and `storage/private` must already exist as directories; an invalid root fails before inventory. This cannot identify an incorrectly selected but structurally valid deployment, so pairing the intended database and storage remains the operator's responsibility. Failed entries carry bounded reason codes such as `PERMISSION_DENIED`, `STORAGE_FULL` or `QUARANTINE_MISMATCH`; raw storage errors are not included. Filename ownership and conflict checks conservatively ignore case for legacy storage aliases on case-insensitive volumes.

After inspecting the report, explicitly apply:

```powershell
npx.cmd tsx scripts/reconcile-catalog-public-media.ts --storage-root 'C:\deployment\app' --apply
```

For each exposed catalog file, apply writes and syncs exact public bytes into `storage/catalog-quarantine/<filename>/<sha256>`, verifies them, writes and syncs a preservation record in `storage/catalog-quarantine/preservation.jsonl`, then removes `public/uploads/<filename>`. The private original is untouched even when its bytes differ. Recovery paths are relative to the selected root. Repeated preservation records are expected after interrupted attempts; content-addressed recovery objects are reused only after exact byte verification. Interrupted staging files ending in `.tmp` remain private; preserve them for investigation and remove them only after verifying a complete recovery object. No automatic recovery garbage collection is included.

An exposed filename also referenced by any noncatalog media row or the current store logo is a `conflict`. Its public bytes are preserved in place, and the command exits unsuccessfully. Separate those references onto distinct media keys through an operator-approved data correction, preserving their bytes and historical links, then rerun inventory and apply. The command never silently removes unrelated media or logos. `failed` also produces exit status 1. Partial progress is durable and a retry is supported; missing public paths are successful no-ops. Keep the command's JSON output with the recovery records. An argument/database failure reports an unsuccessful exit without exposing credentials.

Run inventory again and confirm all scoped entries are `absent` before restarting with the fixed application and serving the updated static tree. Replace any stale packaged/static copies as part of that controlled rollout; ensure old replicas cannot continue serving them. Restart is needed because framework/static servers may inventory public paths at startup. Do not treat local-file withdrawal as proof of deployed revocation.

## Runtime behavior and recovery

Unpublishing reconciles all active and historical attachments before committing a draft transition. Already-draft requests reconcile too, without another status/timestamp/audit change. Conflicts return 409; storage withdrawal failures return a safe 503. Retry after correcting the cause. A failed transaction may already have withdrawn some public paths: filesystem preservation is independently durable and is intentionally not undone on audit/database rollback.

To recover bytes for an investigation, locate the record by filename and SHA-256, verify the recovery object's checksum and length, and copy it to an access-controlled location. Do not restore catalog bytes under `public`. The original remains in `storage/private`.

The operation assumes trusted deployment directories and no concurrent external filesystem writers. It detects public-byte changes during preservation, but does not provide a cross-process filesystem/database transaction. PGlite tests do not establish PostgreSQL concurrency behavior, crash/power-loss guarantees for every filesystem, deployed static-server behavior or remote-cache revocation. Downloaded files, browser/proxy/CDN caches and external copies require separate investigation and purge procedures. A1 does not resolve packaging A2 or change the retrospective's aggregate rejection.
