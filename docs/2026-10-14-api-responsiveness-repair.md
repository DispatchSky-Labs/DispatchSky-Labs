# Sadiom Flow intermittent responsiveness — 14 October 2026

## Observed behavior and confidence

Production source: commit `27de44ed8203de51aefa0c7f89bc75796f8e9a2c`.
Railway deployment: `4e65569a-5ca6-46c0-bfc9-094012e761b7` (24 September).
Project `957c4e91-2a23-49bb-875f-f3f8cf45214c`, service
`28f9ce33-ec95-4255-a854-a3a572122ad0`, production environment
`2535f2f8-4d11-4ab4-8368-a985f2c56f82`.

| Evidence | Interpretation |
| --- | --- |
| SKW5694 XNA–DEN lookup returned 2310Z and fresh source status at 2046Z; the request took 9.7 seconds from the diagnostic client. | The flight lookup can return data while API responsiveness is degraded. This is an ETD observation, not verification of an assigned EDCT. |
| Railway logged `/api/health` at 3 ms at 2049:56Z and 6,747 ms at 2050:18Z. | Requests can stall inside the backend/proxy path even without an FAA fetch or session work. Client network time alone does not explain the slowdown. |
| Source code synchronously stringified and rewrote every table on each insert/update, including routine session reads. An existing `/api/session` caused three complete saves; a new session caused five. | A directly identified blocking defect; overlapping requests and polling multiply its cost. |
| Each workspace refresh appended a complete airport snapshot without retention. | The data serialized by every save could grow continuously. |
| IP enrichment awaited two optional external providers, each with a default 3-second timeout. Failed enrichment was not cached. | A second avoidable latency source, dependent on provider response and client IP. |
| Browser GET timeout is 12 seconds; Railway also logged approximately 12-second client-aborted lookups on 10–12 October. | Explains the success/failure boundary. Earlier failures existed, though they do not establish how often the owner encountered them. |

The blocking persistence path is confirmed in source. We did **not** obtain the
production database, measure its size, or profile individual live saves during
diagnosis. Its exact contribution to each slow request, and the particular
trigger for today's worsening, remain unmeasured. Scanner traffic may amplify
load; the afternoon burst does not explain earlier failures that day. No
repository deployment occurred today. These limits must remain visible when
describing the incident.

## Repair

- Node 24 built-in SQLite stores one JSON document per row. A dedicated worker
  serializes changed rows and commits them in ordered transactions. Routine
  requests no longer stringify or rewrite the complete store.
- API responses await their queued commit. Commit failures return HTTP 503;
  health becomes unhealthy if the worker fails. A health check does not wait
  behind queued writes. `WAL` and `synchronous=FULL` are enabled.
- Keep at most the latest successful and latest failed snapshot per airport,
  preserving the successful flight list through later source errors. Migration
  compacts only these redundant snapshots; user flights, sessions, states,
  alert acknowledgments, deliveries, usage and admin records are preserved.
- IP enrichment runs in the background, shares in-flight work per hashed IP,
  caches failures for five minutes and successes for 24 hours. Header/cached
  enrichment remains immediately available. Admin analytics may populate
  shortly after the first response.
- Unknown API paths return 404 before creating a session or writing anything.
- Explicit row deletions replace the former whole-store save. Shutdown drains
  active requests, scheduled refresh work, enrichment and pending writes.

The browser's 12/20-second timeouts, polling intervals, source client/backoff,
flight normalization/matching, ETD fields, stale-source handling and alert
thresholds are unchanged. This remains a **single-process, single-replica**
application with in-memory reads. SQLite is durable storage, not a change to
multi-instance coordination. Non-snapshot histories remain unbounded and
should be reviewed separately if memory growth persists.

## Migration and rollout — preserve live data before merging

At investigation time the production service had **no persistent volume**.
`EDCT_DB_FILE` is a redacted variable; do not guess its live path. Rebuilding or
attaching a volume before retrieving the existing JSON can lose saved state.
The Railway connector can read deployment/configuration metadata but cannot
read the running container filesystem. An authenticated Railway CLI/SSH
session (or an equivalent authorized container-access path) is required for
the initial handoff. Do not put database contents or credentials in GitHub.

1. Keep this repair on its PR branch until a backup is secured. Main is the
   production deployment source and its Railway check-suite gate is disabled.
   Do not assume adding CI will delay deployment after merge.
2. Use SSH to inspect the actual `EDCT_DB_FILE` in the current container. Copy
   the JSON to private durable storage. Because the old writer truncates and
   rewrites in place, use a brief controlled maintenance window to freeze writes
   for the final copy. Parse the copy and record its checksum and table counts.
   Preserve the original deployment until the handoff has been verified.
3. Create/prepare a persistent Railway volume, then transfer the verified
   final JSON to it. Staging the volume in a separate migration service avoids
   replacing the old container merely to populate the volume. Attach the
   populated volume to the API only after the backup is secure. Resolve the
   service/volume handoff explicitly; attaching a volume itself can redeploy.
4. Keep one replica. Run Node 24. Set `EDCT_DB_FILE` to the restored JSON path
   on the volume (for example `/data/edct-db.json`) and
   `EDCT_REQUIRE_EXISTING_DB=true`. The corresponding live SQLite path will be
   `/data/edct-db.json.sqlite`. Both paths must be on that persistent mount.
5. On the repair revision, with the API stopped, validate migration:

   ```sh
   node scripts/storage.mjs migrate /data/edct-db.json
   ```

   This imports in one transaction, leaves the JSON untouched, and prints
   table counts without row contents. Compare all operational table counts
   against the final backup; only snapshot count should shrink. A missing,
   invalid or incompatible database must stop rollout. Failed imports can
   be retried after correcting their input; no partial import is committed.
6. Merge/deploy the tested revision only after the data handoff and runtime
   configuration are ready. Wait for Railway terminal `SUCCESS`; inspect logs.
   Verify health, the owner's existing cookie/session and watchlist, a current
   flight lookup, alert acknowledgment and restart persistence. Compare
   proxy API latencies against the measurements above during normal polling.
   Test a flight lookup only if its flight is present in the source at the time.
7. Retain the private original JSON backup and capture a supported SQLite
   backup after validation. Never back up a live WAL database by copying just
   the `.sqlite` file; use SQLite backup facilities or stop all writes first.

The missing-data guard defaults **on when `RAILWAY_PROJECT_ID` is present**.
It prevents an accidental rebuild from silently replacing watchlists with an
empty database. Fresh local databases can be created normally; a deliberately
fresh Railway staging installation can explicitly set
`EDCT_REQUIRE_EXISTING_DB=false`. Do not disable this guard in production.
A deployment without persistent storage is not an approved rollout.

## Rollback

Before accepting new traffic, reverting code plus the untouched original JSON
is possible. After new writes have reached SQLite, the original JSON is stale:
**do not simply deploy the old JSON-only revision**. During maintenance, stop
the API and export the current SQLite state to a new private file:

```sh
node scripts/storage.mjs export /data/edct-db.json /data/rollback-current.json
```

The export refuses to overwrite an existing file. Verify counts, preserve the
SQLite files, and point the old revision's `EDCT_DB_FILE` at this export on the
persistent volume. Then validate the owner's session, flights and alerts. The
old performance defect returns with old code; rollback is a recovery option,
not a long-term remedy.

## Validation

`npm test` runs on Node 24. Existing regression cases cover matching, fresh and
stale source behavior, source caching/backoff, flight CRUD, session cookies,
ETD-met lifecycle, alert dedupe/acknowledgment/delivery, idle polling and NAS
shadow behavior. New cases verify:

- migration and restart preserve all operational tables and the original JSON;
- malformed input rolls back and can be retried; missing required data fails;
- repeated successes/failures remain bounded and retain the latest good data;
- a session update does not serialize an unrelated large flight record;
- transaction failure rejects persistence without a partial commit;
- a real SQLite write lock delays session success while health stays responsive;
- optional stalled IP providers do not block responses, duplicate work or get
  retried on every request;
- unknown API paths create no sessions/writes; failed commits return 503.

These tests validate the repair locally. They do not establish post-deployment
production latency or substitute for the backup and rollout checks above.

One local synthetic comparison used 1,000 successful DEN snapshots, each with
250 flight records (87.5 MiB of pretty-printed legacy JSON). For the same new
`ensureSession` operation, the old store took 889.4 ms; the repaired store's
row commits took 51.2 ms, including worker startup. Migration retained one
latest snapshot. Migration time was excluded from both request measurements.
This is a synthetic check of the identified mechanism, not a measurement of
the production database or a production latency guarantee.
