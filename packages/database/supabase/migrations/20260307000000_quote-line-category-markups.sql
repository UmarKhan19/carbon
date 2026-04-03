ALTER TABLE "quoteLinePrice" ADD COLUMN "categoryMarkups" JSONB DEFAULT '{}';
ALTER TABLE "companySettings" ADD COLUMN "quoteLineCategoryMarkups" JSONB DEFAULT '{}';