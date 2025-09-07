-- Add passwordHash field to merchants table
ALTER TABLE merchants ADD COLUMN "passwordHash" text;

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'merchants' AND column_name = 'passwordHash';