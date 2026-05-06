-- Make p_company_group_id optional on accountTreeBalancesByCompany.
-- When omitted, derive it from p_company_id. This unblocks callers
-- (e.g. financial reports) where the auth session was created before
-- companyGroupId was added and therefore arrives as undefined,
-- causing supabase-js to drop the parameter and PostgREST to fail
-- with PGRST202 (no matching function in schema cache).

CREATE OR REPLACE FUNCTION "accountTreeBalancesByCompany" (
  p_company_group_id TEXT DEFAULT NULL,
  p_company_id TEXT DEFAULT NULL,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "balance" NUMERIC(19, 4),
  "balanceAtDate" NUMERIC(19, 4),
  "netChange" NUMERIC(19, 4)
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_company_group_id TEXT;
BEGIN
  v_company_group_id := COALESCE(
    p_company_group_id,
    (SELECT "companyGroupId" FROM "company" WHERE "id" = p_company_id)
  );

  RETURN QUERY
    WITH RECURSIVE "accountTree" AS (
      SELECT
        a."id",
        a."id" AS "rootId",
        a."isGroup"
      FROM "account" a
      WHERE a."companyGroupId" = v_company_group_id AND a."active" = true

      UNION ALL

      SELECT
        child."id",
        t."rootId",
        child."isGroup"
      FROM "accountTree" t
      INNER JOIN "account" child ON child."parentId" = t."id"
      WHERE t."isGroup" = true
        AND child."companyGroupId" = v_company_group_id
        AND child."active" = true
    ),
    "leafBalances" AS (
      SELECT
        a."id" AS "accountId",
        COALESCE(SUM(jl."amount"), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
        AND (p_company_id IS NULL OR jl."companyId" = p_company_id)
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."companyGroupId" = v_company_group_id
        AND a."isGroup" = false
        AND a."active" = true
      GROUP BY a."id"
    )
    SELECT
      t."rootId" AS "accountId",
      COALESCE(SUM(lb."balance"), 0)::NUMERIC(19, 4) AS "balance",
      COALESCE(SUM(lb."balanceAtDate"), 0)::NUMERIC(19, 4) AS "balanceAtDate",
      COALESCE(SUM(lb."netChange"), 0)::NUMERIC(19, 4) AS "netChange"
    FROM "accountTree" t
    LEFT JOIN "leafBalances" lb ON lb."accountId" = t."id" AND t."isGroup" = false
    GROUP BY t."rootId";
END;
$$;

NOTIFY pgrst, 'reload schema';
