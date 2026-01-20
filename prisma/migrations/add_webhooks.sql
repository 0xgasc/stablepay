-- Add webhook columns to merchants table
ALTER TABLE "public"."merchants"
ADD COLUMN IF NOT EXISTS "webhookUrl" TEXT,
ADD COLUMN IF NOT EXISTS "webhookSecret" TEXT,
ADD COLUMN IF NOT EXISTS "webhookEnabled" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "webhookEvents" TEXT[] DEFAULT '{}';

-- Create webhook_logs table
CREATE TABLE IF NOT EXISTS "public"."webhook_logs" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "url" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "response" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "nextRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'webhook_logs_merchantId_fkey'
    ) THEN
        ALTER TABLE "public"."webhook_logs"
        ADD CONSTRAINT "webhook_logs_merchantId_fkey"
        FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Create indexes for webhook_logs
CREATE INDEX IF NOT EXISTS "webhook_logs_merchantId_idx" ON "public"."webhook_logs"("merchantId");
CREATE INDEX IF NOT EXISTS "webhook_logs_event_idx" ON "public"."webhook_logs"("event");
CREATE INDEX IF NOT EXISTS "webhook_logs_nextRetryAt_idx" ON "public"."webhook_logs"("nextRetryAt");
