-- Add Assembly to module enum
-- Note: The enum value must be added in a separate transaction from its usage
ALTER TYPE module ADD VALUE IF NOT EXISTS 'Assembly';
