-- Fix for a design bug: prior to this migration, `upsertInboundInspectionSample`
-- would auto-flip the lot-level status to 'Passed' or 'Failed' as soon as the
-- sample counts crossed the accept/reject threshold. That collapsed the two
-- levels (sample vs. lot), making the disposition buttons disable themselves
-- before the inspector had a chance to cascade the decision to the un-sampled
-- tracked entities.
--
-- Going forward, auto-recompute only flips between 'Pending' and 'In Progress';
-- terminal states are set exclusively by the disposition action (which also
-- writes `dispositionedAt`). Any existing lot whose status is terminal but was
-- never dispositioned is a victim of the old logic — reset it so the inspector
-- can disposition it.

UPDATE "inboundInspection"
SET "status" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "inboundInspectionSample" s
    WHERE s."inboundInspectionId" = "inboundInspection"."id"
      AND s."status" <> 'Pending'
  ) THEN 'In Progress'::"inboundInspectionStatus"
  ELSE 'Pending'::"inboundInspectionStatus"
END
WHERE "dispositionedAt" IS NULL
  AND "status" IN ('Passed', 'Failed', 'Partial');
