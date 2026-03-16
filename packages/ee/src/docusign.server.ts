import {
  DOCUSIGN_ACCOUNT_ID,
  DOCUSIGN_INTEGRATION_KEY,
  DOCUSIGN_OAUTH_REDIRECT_URL,
  DOCUSIGN_SECRET_KEY,
  getAppUrl
} from "@carbon/auth";
import { randomBytes } from "node:crypto";
import { z } from "zod";

export * from "./docusign/lib/client";
export * from "./docusign/lib/service";

export const docuSignOAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string().optional()
});

export const docuSignOAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  refresh_token: z.string(),
  expires_in: z.number()
});

export const docuSignUserInfoSchema = z.object({
  sub: z.string(),
  name: z.string(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  email: z.string(),
  accounts: z.array(
    z.object({
      account_id: z.string(),
      is_default: z.boolean(),
      account_name: z.string(),
      base_uri: z.string()
    })
  )
});

// Simple in-memory state store for OAuth
const stateStore = new Map<
  string,
  { companyId: string; userId: string; createdAt: number }
>();

// Clean up expired states (older than 10 minutes)
const cleanupStates = () => {
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  for (const [key, value] of stateStore.entries()) {
    if (now - value.createdAt > tenMinutes) {
      stateStore.delete(key);
    }
  }
};

export const getDocuSignInstallUrl = ({
  companyId,
  userId
}: {
  companyId: string;
  userId: string;
}): string => {
  if (!DOCUSIGN_INTEGRATION_KEY) {
    throw new Error("DocuSign integration key is not configured");
  }

  cleanupStates();

  // Generate a random state for CSRF protection
  const state = randomBytes(32).toString("hex");
  stateStore.set(state, { companyId, userId, createdAt: Date.now() });

  const redirectUri =
    DOCUSIGN_OAUTH_REDIRECT_URL || `${getAppUrl()}/api/integrations/docusign/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    scope: "signature impersonation",
    client_id: DOCUSIGN_INTEGRATION_KEY,
    redirect_uri: redirectUri,
    state
  });

  // Use demo environment by default
  return `https://account-d.docusign.com/oauth/auth?${params.toString()}`;
};

export const verifyDocuSignState = (
  state: string
): { companyId: string; userId: string } | null => {
  const stateData = stateStore.get(state);
  if (!stateData) return null;

  // Remove the state after verification (one-time use)
  stateStore.delete(state);

  return { companyId: stateData.companyId, userId: stateData.userId };
};

export const exchangeDocuSignCode = async (
  code: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  accountId: string;
  baseUri: string;
  userEmail: string;
  userName: string;
}> => {
  if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_SECRET_KEY) {
    throw new Error("DocuSign credentials are not configured");
  }

  const redirectUri =
    DOCUSIGN_OAUTH_REDIRECT_URL || `${getAppUrl()}/api/integrations/docusign/callback`;

  const credentials = Buffer.from(
    `${DOCUSIGN_INTEGRATION_KEY}:${DOCUSIGN_SECRET_KEY}`
  ).toString("base64");

  // Exchange code for tokens
  const tokenResponse = await fetch(
    "https://account-d.docusign.com/oauth/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    }
  );

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to exchange code for token: ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  const parsedToken = docuSignOAuthTokenResponseSchema.safeParse(tokenData);

  if (!parsedToken.success) {
    throw new Error("Invalid token response from DocuSign");
  }

  // Get user info to find account ID
  const userInfoResponse = await fetch(
    "https://account-d.docusign.com/oauth/userinfo",
    {
      headers: {
        Authorization: `Bearer ${parsedToken.data.access_token}`
      }
    }
  );

  if (!userInfoResponse.ok) {
    throw new Error("Failed to get user info from DocuSign");
  }

  const userInfoData = await userInfoResponse.json();
  const parsedUserInfo = docuSignUserInfoSchema.safeParse(userInfoData);

  if (!parsedUserInfo.success) {
    throw new Error("Invalid user info response from DocuSign");
  }

  // Find the default account or use the first one
  const defaultAccount =
    parsedUserInfo.data.accounts.find((a) => a.is_default) ||
    parsedUserInfo.data.accounts[0];

  if (!defaultAccount) {
    throw new Error("No DocuSign accounts found for this user");
  }

  return {
    accessToken: parsedToken.data.access_token,
    refreshToken: parsedToken.data.refresh_token,
    expiresIn: parsedToken.data.expires_in,
    accountId: DOCUSIGN_ACCOUNT_ID || defaultAccount.account_id,
    baseUri: defaultAccount.base_uri,
    userEmail: parsedUserInfo.data.email,
    userName: parsedUserInfo.data.name
  };
};
