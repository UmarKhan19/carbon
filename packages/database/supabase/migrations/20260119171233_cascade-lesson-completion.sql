
ALTER TABLE "lessonCompletion"
DROP CONSTRAINT IF EXISTS "lessonCompletion_userId_fkey";
ALTER TABLE "lessonCompletion"
ADD CONSTRAINT "lessonCompletion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "challengeAttempt"
DROP CONSTRAINT IF EXISTS "challengeAttempt_userId_fkey";
ALTER TABLE "challengeAttempt"
ADD CONSTRAINT "challengeAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;