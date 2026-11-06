# ParcelTrack Bridge API

Standalone Node.js service that connects WooCommerce stores to the **existing** ParcelTrack Railway PostgreSQL database without modifying the ParcelTrack application or schema.

## Databases

| Database | Purpose |
| --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | Existing ParcelTrack DB (`shipments`, `timeline_events`) |
| `BRIDGE_META_DATABASE_URL` | Bridge-only metadata (stores, hashed keys, idempotency) |

**Never run Prisma migrate/push against the ParcelTrack schema from this service.**  
Only push the **meta** schema:

```bash
npm run prisma:meta:push
```

## Crash-safe creation (v1.1)

1. Validate eligibility attestation (`date_paid` required; status alone rejected)
2. Atomically acquire `(storeId, wooOrderId)` lease (`leaseOwner` + `fenceToken`) with pre-allocated `TRK-XXXXXXXX`
3. Insert shipment + 12 timeline events into ParcelTrack using that tracking number (`shippingDate` = dispatch/sync time)
4. Fence-checked metadata `COMPLETED`

If step 3 succeeds and the process crashes before step 4, the next request reconciles via reserved tracking number + orderId ownership checks — **no duplicate shipment**.

Tracking GET returns only shipments owned by the authenticated store (no cross-store reads / no buyer PII).

See `../docs/PAYMENT_TRUST_BOUNDARY.md` and `../docs/CROSS_DB_RECOVERY.md`.

## Quick start

```bash
cp .env.example .env
# fill DATABASE_URL, DIRECT_URL, BRIDGE_META_DATABASE_URL, BRIDGE_ADMIN_API_KEY
npm install
npm run prisma:meta:push
npm run dev
```

## Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/health` | none |
| GET | `/api/connection/test` | store API key |
| POST | `/api/shipments` | store API key |
| GET | `/api/shipments/:trackingNumber` | store API key |
| GET | `/api/orders/:storeId/:orderId` | store API key |
| POST | `/api/admin/stores` | admin API key |
| GET | `/api/admin/stores` | admin API key |
| GET | `/api/admin/diagnostics` | admin API key |

### Register a store

```bash
curl -X POST "$BRIDGE_URL/api/admin/stores" \
  -H "Authorization: Bearer $BRIDGE_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Woo Store","externalRef":"store-a"}'
```

Save the returned `apiKey` once — it is not shown again. Put it in the WooCommerce plugin settings.

### Bootstrap single-store key

Optionally set `BRIDGE_BOOTSTRAP_STORE_KEY` so a default store is ensured on boot.

## Railway

1. Create a **new** Railway Postgres for Bridge metadata
2. Create a Railway service from this `bridge-api` folder (Dockerfile included)
3. Set env vars from `.env.example`
4. Point `DATABASE_URL` / `DIRECT_URL` at the **existing** ParcelTrack database (read/write)
5. Point `BRIDGE_META_DATABASE_URL` at the new metadata database
6. After first deploy, run `npm run prisma:meta:push` once (local or one-off Railway shell)
7. Register stores with the admin API

See root `docs/RAILWAY_DEPLOYMENT.md`.
