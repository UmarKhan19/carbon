-- Batch variants of the existing per-entity strict traversal RPCs.
-- Saves N round-trips per BFS hop where N = frontier size.

DROP FUNCTION IF EXISTS get_direct_descendants_of_tracked_entities_strict;
CREATE OR REPLACE FUNCTION get_direct_descendants_of_tracked_entities_strict(p_tracked_entity_ids TEXT[])
RETURNS TABLE (
    "sourceEntityId" TEXT,
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        seed.id AS "sourceEntityId",
        ta."id" AS "trackedActivityId",
        te."id",
        te."readableId",
        te."quantity",
        te."status",
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM unnest(p_tracked_entity_ids) AS seed(id)
    JOIN "trackedActivityOutput" tao ON tao."trackedEntityId" = seed.id
    JOIN "trackedActivityInput" tai ON tai."trackedActivityId" = tao."trackedActivityId"
    LEFT JOIN "trackedActivityInput" tai2
        ON tai2."trackedActivityId" = tao."trackedActivityId"
        AND tai2."trackedEntityId" = seed.id
    JOIN "trackedEntity" te ON te."id" = tai."trackedEntityId"
    JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
    WHERE tai2."trackedEntityId" IS NULL;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS get_direct_ancestors_of_tracked_entities_strict;
CREATE OR REPLACE FUNCTION get_direct_ancestors_of_tracked_entities_strict(p_tracked_entity_ids TEXT[])
RETURNS TABLE (
    "sourceEntityId" TEXT,
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        seed.id AS "sourceEntityId",
        ta."id" AS "trackedActivityId",
        te."id",
        te."readableId",
        te."quantity",
        te."status",
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM unnest(p_tracked_entity_ids) AS seed(id)
    JOIN "trackedActivityInput" tai ON tai."trackedEntityId" = seed.id
    JOIN "trackedActivityOutput" tao ON tao."trackedActivityId" = tai."trackedActivityId"
    LEFT JOIN "trackedActivityOutput" tao2
        ON tao2."trackedActivityId" = tai."trackedActivityId"
        AND tao2."trackedEntityId" = seed.id
    JOIN "trackedEntity" te ON te."id" = tao."trackedEntityId"
    JOIN "trackedActivity" ta ON ta."id" = tao."trackedActivityId"
    WHERE tao2."trackedEntityId" IS NULL;
END;
$$ LANGUAGE plpgsql;
