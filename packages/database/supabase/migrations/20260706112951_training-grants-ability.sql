-- Training -> ability bridge (spec phase 7): completing a training that
-- grants an ability upserts the employee's qualification.

ALTER TABLE "training"
  ADD COLUMN "grantsAbilityId" TEXT REFERENCES "ability"("id") ON DELETE SET NULL;
CREATE INDEX "training_grantsAbilityId_idx" ON "training" ("grantsAbilityId");

CREATE OR REPLACE FUNCTION grant_ability_on_training_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  granted_ability_id TEXT;
  recertify_days INTEGER;
  completed_date DATE;
BEGIN
  SELECT t."grantsAbilityId", a."recertifyEveryDays"
    INTO granted_ability_id, recertify_days
  FROM "trainingAssignment" ta
  JOIN "training" t ON t."id" = ta."trainingId"
  LEFT JOIN "ability" a ON a."id" = t."grantsAbilityId"
  WHERE ta."id" = NEW."trainingAssignmentId";

  IF granted_ability_id IS NULL THEN
    RETURN NEW;
  END IF;

  completed_date := COALESCE(NEW."completedAt"::date, CURRENT_DATE);

  INSERT INTO "employeeAbility"
    ("employeeId", "abilityId", "companyId", "active", "trainingCompleted", "lastTrainingDate", "expiresAt")
  VALUES (
    NEW."employeeId",
    granted_ability_id,
    NEW."companyId",
    TRUE,
    TRUE,
    completed_date,
    CASE WHEN recertify_days IS NOT NULL
      THEN completed_date + recertify_days
      ELSE NULL END
  )
  ON CONFLICT ("employeeId", "abilityId") DO UPDATE SET
    "active" = TRUE,
    "trainingCompleted" = TRUE,
    "lastTrainingDate" = EXCLUDED."lastTrainingDate",
    "expiresAt" = EXCLUDED."expiresAt";

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_ability_on_training_completion ON "trainingCompletion";
CREATE TRIGGER grant_ability_on_training_completion
AFTER INSERT ON "trainingCompletion"
FOR EACH ROW EXECUTE FUNCTION grant_ability_on_training_completion();
