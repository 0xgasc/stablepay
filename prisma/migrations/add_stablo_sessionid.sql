-- Stablo chats for order-less sessions. The "Where's your crypto?" source step means most
-- sessions chat BEFORE an order exists; persistence used to be skipped entirely in that case,
-- silently dropping the customer questions we built Stablo to capture.
ALTER TABLE stablo_chats ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE stablo_chats ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
CREATE INDEX IF NOT EXISTS "stablo_chats_sessionId_idx" ON stablo_chats ("sessionId");
