# MongoDB Backup & Disaster Recovery

## Status

**DOCUMENTED** — restore drill must be executed against staging before claiming PASS.

## Targets

| Metric | Target | Notes |
|--------|--------|-------|
| RPO | ≤ 1 hour | Point-in-time / continuous backup preferred (Atlas) |
| RTO | ≤ 4 hours | Documented restore + app cutover |
| Retention | 30 days continuous + weekly for 12 weeks | Adjust per compliance |

## Atlas (recommended)

1. Enable **Cloud Backup** with continuous PITR
2. Snapshot schedule: every 6 hours minimum if PITR unavailable
3. Test restore quarterly into a scratch cluster
4. Store connection strings / restore runbook in the ops vault (not git)

## Self-hosted Mongo

```bash
# Logical backup
mongodump --uri="$MONGO_URI" --gzip --archive=/backups/eatiefy-$(date +%F).gz

# Restore to scratch DB (NEVER overwrite prod without change window)
mongorestore --uri="$MONGO_RESTORE_URI" --gzip --archive=/backups/eatiefy-YYYY-MM-DD.gz --drop
```

## Restore process (checklist)

1. Declare incident; freeze deploys
2. Provision scratch / restore cluster
3. Restore latest snapshot or PITR timestamp
4. Point a staging API at restore URI; run smoke tests (auth, order create, webhook)
5. Cut over DNS / `MONGO_URI` only after validation
6. Verify Redis/BullMQ/Socket health via `/ready`
7. Post-incident: root cause + backup gap analysis

## App data outside Mongo

- Cloudinary (production uploads): enable Cloudinary backup / versioning
- Redis: ephemeral (cache, rate limit, idempotency TTL) — rebuildable; do not treat as SoR

## Verification

Restore tested: **NOT TESTED** (fill date + operator after first drill)
