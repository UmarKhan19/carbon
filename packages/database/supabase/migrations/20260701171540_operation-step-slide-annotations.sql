-- Per-slide display size + image annotations (numbered pins) for step reference images.
-- Extends the *OperationStepSlide tables from 20260621154233_operation-step-slides.sql.
--
--   size        — display size in the BOP editor grid and the MES operator view.
--                 'small' | 'medium' | 'large'; defaults to 'medium' (backward compatible:
--                 every existing slide keeps today's medium look).
--   annotations — JSONB array of numbered pins overlaid on the image, shape:
--                 [{ "id": text, "x": 0..1, "y": 0..1, "label"?: text, "color"?: text }, ...].
--                 x/y are fractions of the image box so they survive any rendered size.
--                 Defaults to '[]' (no annotations).
--
-- Authored on the method template and copied to job/quote by get-method (copyStepSlides),
-- exactly like the caption/order columns. IF NOT EXISTS so a re-run on a shared dev volume
-- is a no-op instead of a hard failure (mirrors the parent slides migration).

-- methodOperationStepSlide -------------------------------------------------------------------
ALTER TABLE "methodOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "annotations" JSONB NOT NULL DEFAULT '[]';

-- jobOperationStepSlide ----------------------------------------------------------------------
ALTER TABLE "jobOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "annotations" JSONB NOT NULL DEFAULT '[]';

-- quoteOperationStepSlide --------------------------------------------------------------------
ALTER TABLE "quoteOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "annotations" JSONB NOT NULL DEFAULT '[]';

-- Constrain size to the three allowed values (guard against bad writes; NOT VALID-free since
-- every existing row is the default 'medium'). DROP-before-ADD keeps a re-run idempotent.
ALTER TABLE "methodOperationStepSlide" DROP CONSTRAINT IF EXISTS "methodOperationStepSlide_size_check";
ALTER TABLE "methodOperationStepSlide"
  ADD CONSTRAINT "methodOperationStepSlide_size_check" CHECK ("size" IN ('small', 'medium', 'large'));

ALTER TABLE "jobOperationStepSlide" DROP CONSTRAINT IF EXISTS "jobOperationStepSlide_size_check";
ALTER TABLE "jobOperationStepSlide"
  ADD CONSTRAINT "jobOperationStepSlide_size_check" CHECK ("size" IN ('small', 'medium', 'large'));

ALTER TABLE "quoteOperationStepSlide" DROP CONSTRAINT IF EXISTS "quoteOperationStepSlide_size_check";
ALTER TABLE "quoteOperationStepSlide"
  ADD CONSTRAINT "quoteOperationStepSlide_size_check" CHECK ("size" IN ('small', 'medium', 'large'));
