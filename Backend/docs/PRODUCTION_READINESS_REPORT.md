# PRODUCTION READINESS REPORT

**Product:** Eatiefy (MERN food delivery backend)  
**Date:** 2026-08-11  
**Scope:** Backend at `Backend/` — discovery, audit, P0/P1 hardening, tests scaffolding  
**Method:** Code evidence only. Latencies and load-test pass/fail marked **NOT MEASURED** unless executed.

---

## Overall Score

**48 / 100**

## Status

**NOT READY** — **READY WITH FIXES** pending measured load/concurrency proof and remaining P0/P1 closure.

| Dimension | Score | Notes |
|-----------|------:|-------|
| Architecture | 6/10 | Modular monolith + PM2 cluster + Redis/BullMQ/Socket adapter designed; local uploads + dual socket init remain risks |
| Code Quality | 5/10 | Large services; business logic concentrated; improved payment path |
| API Performance | 3/10 | **NOT MEASURED** (no p50/p95 in repo or this run) |
| MongoDB | 6/10 | Indexes present on orders; pool configured; some admin unbounded paths capped |
| Redis | 6/10 | Cache, rate-limit, Socket adapter, BullMQ — degrade paths exist |
| Caching | 5/10 | Cache middleware present; not proven under load |
| Concurrency | 5/10 | Delivery accept atomic; payment activation now atomic; order create still not fully idempotent without client key |
| Order Reliability | 5/10 | Webhook now activates order (was P0 gap); still needs concurrency proof |
| Payment Reliability | 6/10 | Signature timing-safe; amount checks; activation shared path |
| Socket.IO | 5/10 | Redis adapter + join-tracking ownership; multi-instance OK if Redis on |
| Queues | 6/10 | BullMQ workers exist |
| Security | 5/10 | FCM test routes gated; payment RBAC; npm audit still critical/high |
| Error Handling | 6/10 | Global handler + shutdown; health/ready improved |
| Scalability | 5/10 | Designed for horizontal scale; not load-proven |
| Observability | 3/10 | requestId exists; console logger only; no metrics/tracing |
| Testing | 2/10 | 8 unit tests pass; k6 scripts added but **not executed** here |
| Deployment | 5/10 | PM2 + nginx examples; no Docker; deploy webhook still RCE-shaped |
| Disaster Recovery | 1/10 | No backup/restore evidence in repo |

---

## Architecture Map (as implemented)

```
CLIENT / CDN
    ↓
NGINX (deploy/nginx-*.example)
    ↓
┌───────────────────┬────────────────────┐
│ PM2 API cluster   │ Dedicated Socket   │
│ :5000             │ :5001              │
└─────────┬─────────┴──────────┬─────────┘
          ↓                    ↓
     Express middleware → controllers → services
          ↓
 ┌────────┴────────┬──────────┬──────────┐
 │ MongoDB         │ Redis    │ BullMQ   │
 │ (pooled)        │ cache/RL │ workers  │
 └─────────────────┴──────────┴──────────┘
          ↓
 External: Razorpay, FCM, SMS India Hub, Firebase RTDB, SMTP
```

---

## Baseline (Phase 2) — NOT MEASURED

| Metric | Value |
|--------|-------|
| API p50 / p95 / p99 | NOT MEASURED |
| Error rate / 4xx / 5xx | NOT MEASURED |
| MongoDB query latency | NOT MEASURED |
| MongoDB connection usage | NOT MEASURED |
| Redis latency | NOT MEASURED |
| CPU / memory / event-loop lag | NOT MEASURED |
| Socket.IO connections | NOT MEASURED |
| Request throughput | NOT MEASURED |
| Payload size | NOT MEASURED |

---

## P0 — BLOCKERS (remaining or partially fixed)

1. **Load / concurrency / chaos not executed** — cannot claim capacity or go-live.  
2. **`npm audit`: 35 vulnerabilities (2 critical, 13 high)** — notably `websocket-driver`, `ws` via socket.io stack; `xlsx`/`nodemailer`/`multer` transitive issues.  
3. **No automated regression for order/payment/webhook** — only unit tests for crypto/pagination.  
4. **Backup / PITR / restore drill** — not evidenced.  
5. **Observability gap** — no Prometheus/OTel; console logs insufficient for multi-instance prod.  
6. **Local disk uploads** — break multi-host horizontal scale without shared volume/object storage.  
7. **Deploy webhook still executes shell** (`./deploy.sh`) — timing-safe compare added; still high-risk surface. Prefer CI/CD.  
8. **Order create without `Idempotency-Key`** — middleware is optional; double-click can still create two orders.  
9. **SMS over HTTP** (`smsindiahub`) — OTP in clear on the wire (pre-existing).  

### P0 fixed in this pass (code)

- Unauthenticated FCM token set/get by phone → **removed in production**; admin-only in non-prod.  
- Payment admin/wallet IDOR → **role gates + ownership checks**.  
- Socket `join-tracking` without ownership → **order membership check**.  
- Razorpay webhook marked `payment.paid` but **did not activate** `pending_payment` → restaurant never saw order → **shared activation path**.  
- Signature compares → **timing-safe**.  
- `USE_DEFAULT_OTP` in production → **hard fail at boot**.  
- Mongo pool unbounded defaults → **maxPoolSize/minPoolSize/timeouts**.  
- `/ready` always 200 → **Mongo (+ Redis when enabled) readiness**.  

---

## P1 — HIGH PRIORITY

- Make `Idempotency-Key` **required** for `POST /orders` in production.  
- Structured JSON logging + metrics (latency, 5xx, event-loop lag, queue depth).  
- Fix/upgrade vulnerable deps (`npm audit fix` carefully; socket.io/`ws`).  
- Shared object storage for uploads (or sticky single upload node).  
- Disable or tightly gate `/api/deploy` in production.  
- Webhook event idempotency store (event id) in Redis/Mongo.  
- Admin list endpoints still use heavy regex search — add text indexes or constrain.  
- Auth middleware hits Mongo on every USER request (`isActive`) — cache or JWT claim with short TTL.  

---

## P2 — PERFORMANCE / SCALABILITY

- Cursor pagination for large admin lists.  
- Stampede protection on hot cache keys.  
- Separate read preferences / secondary reads for catalogs.  
- Socket location sync volume / Redis hot hashes monitoring.  
- Cap remaining `find({})` admin/dining helpers.  

---

## P3 — OPTIONAL

- Extract payment/worker microservices only if ownership/scale demands.  
- Docker images for reproducible deploys.  
- Distributed tracing.  

---

## CRITICAL API REPORT

| Endpoint | Current latency | DB time | External | Root cause | Fix | Expected improvement |
|----------|-----------------|---------|----------|------------|-----|----------------------|
| `POST /api/v1/food/orders` | NOT MEASURED | NOT MEASURED | Razorpay / Maps | Pricing + gateway | Idempotency middleware added (optional) | Duplicate create risk ↓ when clients send key |
| `POST /api/v1/food/orders/verify-payment` | NOT MEASURED | NOT MEASURED | Razorpay fetch | Race with webhook | Shared atomic activation | Double-notify/double-ledger risk ↓ |
| `POST /api/v1/payments/webhook/razorpay` | NOT MEASURED | NOT MEASURED | — | Incomplete activation | Full activate + timingSafeEqual | Paid orders reach restaurant |
| Public search / home | NOT MEASURED | NOT MEASURED | — | Cache exists | Measure + tune TTL | TBD after measure |

---

## DATABASE REPORT

**Indexes added/confirmed (orders/payments):**

| Collection | Fields | Query optimized | Expected benefit | Write overhead |
|------------|--------|-----------------|------------------|----------------|
| FoodOrder | `payment.razorpay.orderId` (sparse) | Webhook lookup | Avoid collection scan on webhook | Low |
| FoodOrder | `payment.razorpay.paymentId` (sparse) | Refund webhook | Faster refund sync | Low |
| FoodOrder | `orderStatus + payment.status + createdAt` | Pending payment expiry | Faster cleanup | Low |
| payments | partial unique on `orderId` where status in created/pending/success | findOrCreatePayment race | Prevents duplicate active payments | Medium (unique checks) |
| payments | `gatewayPaymentId` / `gatewayOrderId` sparse | Gateway lookups | Faster reconcile | Low |

**Still open:** admin regex searches; dining `find({})` for small catalogs; subscription invoice unbounded path capped to 200.

**Connection pool:** `MONGO_MAX_POOL_SIZE` default 20, min 2, socket/server timeouts set. Plan: `instances × maxPoolSize < Atlas connection budget`.

---

## SCALABILITY REPORT

| Area | Status |
|------|--------|
| Single-instance limitations | In-memory rate-limit fallback; local uploads; optional in-memory Socket adapter |
| Horizontal API | Ready if Redis + shared upload strategy + `SERVER_BACKGROUND_JOBS_ENABLED=false` on cluster |
| Load balancing | Nginx example present; health/ready now dependency-aware |
| Redis | Required for Socket multi-instance + distributed RL + BullMQ |
| Queues | BullMQ workers in ecosystem |
| Socket.IO | Dedicated process + Redis adapter when enabled |
| DB | Pool capped; still need Atlas sizing for target RPS |

---

## CONCURRENCY REPORT

| Risk | Status |
|------|--------|
| Order duplication | Mitigated only with `Idempotency-Key`; otherwise still possible |
| Payment / webhook race | Shared `confirmOnlinePaymentAndActivateOrder` + atomic `payment.status != paid` |
| Inventory oversell | Not fully audited (food items may not use hard stock) — **NOT PROVEN** |
| Delivery accept | Already atomic `findOneAndUpdate` (prior art) |
| Wallet debit race | Improved payment mark; wallet paths need deeper audit |

---

## SECURITY REPORT

| Severity | Items |
|----------|-------|
| Critical | npm `websocket-driver` advisories; deploy shell webhook surface |
| High | npm `ws`, `nodemailer`, `multer` advisories; SMS HTTP |
| Medium | Optional idempotency; console logging of token previews in socket (masked but still) |
| Low | Public FCM `/check` endpoint metadata |

**Fixed:** FCM phone token IDOR; payment finance IDOR; join-tracking IDOR; default OTP in prod; timing-safe payment/webhook/deploy compares.

---

## LOAD TEST REPORT

Scripts added under `Backend/load-tests/`. **Not executed in this session.**

| Scenario | Result |
|----------|--------|
| 100 users | NOT MEASURED |
| 500 users | NOT MEASURED |
| 1,000 users | NOT MEASURED |
| 5,000 users | NOT MEASURED |
| Traffic spike | NOT MEASURED |
| Concurrent orders | NOT MEASURED |
| Payment concurrency | NOT MEASURED |
| Socket stress | NOT MEASURED |

Run:
```bash
cd Backend
k6 run load-tests/load-suite.js
k6 run -e TOKEN=... -e RESTAURANT_ID=... -e ITEM_ID=... load-tests/concurrency-orders.js
k6 run load-tests/webhook-duplicates.js
k6 run load-tests/socket-stress.js
```

---

## CAPACITY REPORT

**No capacity numbers claimed.** All capacity fields: **NOT MEASURED**.

---

## FILES CHANGED

| File | What / Why | Perf | Reliability | Security |
|------|------------|------|-------------|----------|
| `src/utils/cryptoSafeCompare.js` | timing-safe compare | — | — | + |
| `src/middleware/idempotency.js` | Idempotency-Key for mutating APIs | ↓ duplicate work | + | — |
| `src/modules/food/orders/helpers/razorpay.helper.js` | safe signature verify | — | — | + |
| `src/modules/food/orders/services/order-payment-activation.service.js` | shared paid→created activation | — | ++ | — |
| `src/modules/food/orders/services/order.service.js` | verify uses activation | — | ++ | — |
| `src/core/payments/controllers/razorpayWebhook.controller.js` | full activate + safe HMAC | — | ++ | + |
| `src/core/notifications/fcm.routes.js` | kill open test routes | — | — | ++ |
| `src/core/payments/payment.routes.js` | RBAC | — | — | ++ |
| `src/core/payments/payment.controller.js` | ownership checks | — | — | ++ |
| `src/config/socket.js` | join-tracking authz | slight DB on join | — | ++ |
| `src/config/db.js` | pool + timeouts | + under multi-instance | + | — |
| `src/config/validateEnv.js` | block default OTP in prod | — | — | ++ |
| `src/config/health.js` | live/ready semantics | — | + | — |
| `src/app.js` | /live /ready /health | — | + | — |
| `server.js` | deploy timingSafeEqual; longer drain | — | + | + |
| `src/core/payments/payment.service.js` | atomic success / race-safe create | — | + | — |
| `src/core/payments/models/payment.model.js` | unique active payment index | — | + | — |
| `src/modules/food/orders/models/order.model.js` | razorpay indexes | + webhook | + | — |
| `src/modules/food/orders/routes/order.routes.user.js` | idempotency middleware | — | + | — |
| `src/modules/food/admin/services/admin.service.js` | cap list limits | + | + | — |
| `src/modules/food/admin/services/adminSubscriptionBilling.service.js` | cap 5000→200 | + | + | — |
| `package.json` | test + k6 scripts | — | + | — |
| `load-tests/*` | k6 scenarios A–J | measure | measure | — |
| `tests/*` | unit tests (8 pass) | — | + | + |
| `docs/PRODUCTION_READINESS_REPORT.md` | this report | — | — | — |

---

## TESTS ADDED

| Test | Result |
|------|--------|
| `tests/crypto-and-pagination.test.js` | PASS (7 assertions) |
| `tests/razorpay-signature.test.js` | PASS |
| k6 load-suite / concurrency / webhook / socket | ADDED, NOT RUN |

---

## REMAINING RISKS (not proven)

- Horizontal scale under real traffic  
- Payment + order correctness under 100 concurrent last-item / double-click  
- Redis outage behavior in production path  
- Backup restore  
- Dependency CVEs  
- Inventory semantics  
- End-to-end webhook with live Razorpay  

---

## FINAL GO-LIVE DECISION

# CAN THIS BACKEND GO TO PRODUCTION?

## NO

### Exact blockers

1. No executed load / spike / concurrency / chaos evidence.  
2. Critical/high npm audit findings unresolved.  
3. No backup/DR evidence.  
4. Observability insufficient for multi-instance production ops.  
5. Order idempotency still optional (client may omit key).  
6. Upload storage not multi-host safe.  

### After blockers cleared (minimum)

- Run k6 A–J against staging; publish numbers.  
- Require Idempotency-Key for order create in production.  
- Resolve critical/high audits or accept documented risk.  
- Confirm Redis + PM2 topology from `deploy/PRODUCTION_SCALING.md`.  
- Document and test Mongo backup restore (RPO/RTO).  
- Ship metrics + alerts for 5xx, p95, Mongo pool, Redis, queue depth.  

---

## GO-LIVE CHECKLIST

| Item | Status |
|------|--------|
| Architecture | [WARNING] |
| Authentication | [WARNING] |
| Authorization | [WARNING] (improved; not fully audited all ~330 routes) |
| Database | [WARNING] |
| Indexes | [WARNING] |
| Pagination | [WARNING] |
| Caching | [WARNING] |
| Redis | [WARNING] |
| Order concurrency | [FAIL] (not load-proven) |
| Payment idempotency | [WARNING] |
| Webhook idempotency | [WARNING] |
| Socket.IO | [WARNING] |
| Queues | [WARNING] |
| Workers | [WARNING] |
| Rate limiting | [WARNING] |
| Security | [FAIL] (npm audit critical/high) |
| Error handling | [WARNING] |
| Graceful shutdown | [WARNING] |
| Horizontal scaling | [WARNING] |
| Load balancing | [WARNING] |
| Health checks | [PASS] (code evidence: /live /ready /health) |
| Monitoring | [FAIL] |
| Alerting | [FAIL] |
| Load testing | [FAIL] (scripts only) |
| Stress testing | [FAIL] |
| Backup | [FAIL] |
| Disaster recovery | [FAIL] |
| Regression testing | [FAIL] (minimal unit only) |

---

*This report refuses fabricated benchmarks. Re-score after measured k6 runs and remaining P0 closure.*
