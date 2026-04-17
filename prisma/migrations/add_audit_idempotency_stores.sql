-- Audit batch: AdminAction, IdempotencyKey, RateLimitBucket, per-merchant refund threshold
-- Multi-store batch: Store, StoreWallet + Order/PaymentLink/WebhookLog FKs
-- Idempotent via IF NOT EXISTS guards.

-- ── Audit batch ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."admin_actions" (
  "id"         TEXT PRIMARY KEY,
  "actor"      TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "resource"   TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "reason"     TEXT,
  "ip"         TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "admin_actions_actor_createdAt_idx"    ON "public"."admin_actions"("actor", "createdAt");
CREATE INDEX IF NOT EXISTS "admin_actions_resource_resourceId_idx" ON "public"."admin_actions"("resource", "resourceId");
CREATE INDEX IF NOT EXISTS "admin_actions_action_createdAt_idx"   ON "public"."admin_actions"("action", "createdAt");

CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
  "id"         TEXT PRIMARY KEY,
  "merchantId" TEXT,
  "keyHash"    TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "response"   JSONB NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_keyHash_key"    ON "public"."idempotency_keys"("keyHash");
CREATE INDEX        IF NOT EXISTS "idempotency_keys_createdAt_idx" ON "public"."idempotency_keys"("createdAt");

CREATE TABLE IF NOT EXISTS "public"."rate_limit_buckets" (
  "id"          TEXT PRIMARY KEY,
  "key"         TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count"       INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_buckets_key_windowStart_key" ON "public"."rate_limit_buckets"("key", "windowStart");
CREATE INDEX        IF NOT EXISTS "rate_limit_buckets_windowStart_idx"    ON "public"."rate_limit_buckets"("windowStart");

ALTER TABLE "public"."merchants"
  ADD COLUMN IF NOT EXISTS "refundAutoApproveThreshold" DECIMAL(18,2);

-- ── Multi-store batch ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."stores" (
  "id"              TEXT PRIMARY KEY,
  "merchantId"      TEXT NOT NULL,
  "slug"            TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "displayName"     TEXT,
  "logoUrl"         TEXT,
  "headerColor"     TEXT,
  "headerTextColor" TEXT,
  "website"         TEXT,
  "backButtonText"  TEXT,
  "widgetConfig"    JSONB,
  "successUrl"      TEXT,
  "cancelUrl"       TEXT,
  "webhookUrl"      TEXT,
  "webhookSecret"   TEXT NOT NULL,
  "webhookEnabled"  BOOLEAN NOT NULL DEFAULT false,
  "webhookEvents"   TEXT[] NOT NULL DEFAULT '{}',
  "isArchived"      BOOLEAN NOT NULL DEFAULT false,
  "archivedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stores_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "stores_merchantId_slug_key"       ON "public"."stores"("merchantId", "slug");
CREATE INDEX        IF NOT EXISTS "stores_merchantId_isArchived_idx" ON "public"."stores"("merchantId", "isArchived");

CREATE TABLE IF NOT EXISTS "public"."store_wallets" (
  "id"              TEXT PRIMARY KEY,
  "storeId"         TEXT NOT NULL,
  "chain"           "public"."Chain" NOT NULL,
  "address"         TEXT NOT NULL,
  "supportedTokens" TEXT[] NOT NULL DEFAULT ARRAY['USDC']::TEXT[],
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "priority"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_wallets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "store_wallets_storeId_chain_key" ON "public"."store_wallets"("storeId", "chain");
CREATE INDEX        IF NOT EXISTS "store_wallets_storeId_idx"       ON "public"."store_wallets"("storeId");

-- Order.storeId (nullable for back-compat; back-fill script fills existing rows)
ALTER TABLE "public"."orders"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'orders_storeId_fkey'
                   AND table_schema = 'public' AND table_name = 'orders') THEN
    ALTER TABLE "public"."orders"
      ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "orders_storeId_idx" ON "public"."orders"("storeId");

-- PaymentLink.storeId
ALTER TABLE "public"."payment_links"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'payment_links_storeId_fkey'
                   AND table_schema = 'public' AND table_name = 'payment_links') THEN
    ALTER TABLE "public"."payment_links"
      ADD CONSTRAINT "payment_links_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "payment_links_storeId_idx" ON "public"."payment_links"("storeId");

-- WebhookLog.storeId
ALTER TABLE "public"."webhook_logs"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'webhook_logs_storeId_fkey'
                   AND table_schema = 'public' AND table_name = 'webhook_logs') THEN
    ALTER TABLE "public"."webhook_logs"
      ADD CONSTRAINT "webhook_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "webhook_logs_storeId_idx" ON "public"."webhook_logs"("storeId");
