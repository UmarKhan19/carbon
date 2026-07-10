-- Backfill: migrate any legacy "itemCost" rows still on the 'Standard' costing
-- method to 'FIFO'.
--
-- As of the FIFO item-creation interceptor (20260410031802) new items default to
-- FIFO, so an up-to-date database should have ZERO 'Standard' rows. This migration
-- is written defensively and idempotently to clean up any historical rows that
-- predate the interceptor (or were created by legacy fallback insert paths).
--
-- Rationale: 'Standard' costing is not actually implemented in Carbon — only
-- calculateCOGS honors it, relieving COGS at the flat itemCost.standardCost.
-- FIFO consumes costLedger layers and falls back to itemCost.unitCost when no
-- layers exist. Converted rows will typically have no backfilled cost layers, so
-- to avoid a $0-COGS regression for any row whose unitCost was never populated
-- (Standard items carried their basis in standardCost, not unitCost) we first
-- seed unitCost from standardCost, then flip the method.
--
-- Both statements are idempotent: a second run finds no 'Standard' rows.

-- 1) Preserve cost basis: for still-'Standard' rows with a zero unitCost but a
--    non-zero standardCost, carry the standard into unitCost (the FIFO fallback).
UPDATE "itemCost"
SET "unitCost" = "standardCost"
WHERE "costingMethod" = 'Standard'
  AND COALESCE("unitCost", 0) = 0
  AND COALESCE("standardCost", 0) <> 0;

-- 2) Flip the costing method to FIFO.
UPDATE "itemCost"
SET "costingMethod" = 'FIFO'
WHERE "costingMethod" = 'Standard';
