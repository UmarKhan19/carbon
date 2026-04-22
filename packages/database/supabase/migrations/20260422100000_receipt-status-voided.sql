-- Add "Voided" to the receiptStatus enum so posted receipts can be voided.
ALTER TYPE "receiptStatus" ADD VALUE IF NOT EXISTS 'Voided';
