-- Add PKCE support to OAuth authorization codes
ALTER TABLE "oauthCode" ADD COLUMN "codeChallenge" TEXT;
ALTER TABLE "oauthCode" ADD COLUMN "codeChallengeMethod" TEXT CHECK ("codeChallengeMethod" IN ('S256', 'plain'));

-- Add scope column for OAuth tokens
ALTER TABLE "oauthToken" ADD COLUMN "scope" TEXT;
ALTER TABLE "oauthCode" ADD COLUMN "scope" TEXT;

-- Create table for dynamically registered OAuth clients (for MCP remote servers)
CREATE TABLE "oauthDynamicClient" (
  "id" TEXT PRIMARY KEY DEFAULT id('odcl'),
  "clientId" TEXT NOT NULL UNIQUE,
  "clientSecret" TEXT,
  "clientName" TEXT NOT NULL,
  "redirectUris" TEXT[] NOT NULL DEFAULT '{}',
  "grantTypes" TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
  "responseTypes" TEXT[] NOT NULL DEFAULT ARRAY['code'],
  "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
  "clientUri" TEXT,
  "logoUri" TEXT,
  "scope" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "oauthDynamicClient" ENABLE ROW LEVEL SECURITY;

CREATE INDEX "oauthDynamicClient_clientId_idx" ON "oauthDynamicClient" ("clientId");
