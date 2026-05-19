-- Add WorkCenter to dimensionEntityType enum
-- Must be in its own migration so the value is committed before use
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'WorkCenter';
