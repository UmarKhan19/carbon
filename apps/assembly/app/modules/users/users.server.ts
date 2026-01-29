import { getCarbonServiceRole } from "@carbon/auth";
import type { Database, Json } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Permission {
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
}

export async function getClaims(
  client: SupabaseClient<Database>,
  uid: string,
  company?: string
) {
  return client.rpc("get_claims", { uid, company: company ?? "" });
}

export function getPermissionCacheKey(userId: string) {
  return `permissions:${userId}`;
}

export async function getUser(client: SupabaseClient<Database>, id: string) {
  return client
    .from("user")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
}

export async function getUserClaims(userId: string, companyId: string) {
  let claims: {
    permissions: Record<string, Permission>;
    role: string | null;
  } | null = null;

  try {
    claims = JSON.parse(
      (await redis.get(getPermissionCacheKey(userId))) || "null"
    );
  } finally {
    if (!claims) {
      const rawClaims = await getClaims(
        getCarbonServiceRole(),
        userId,
        companyId
      );
      if (rawClaims.error || rawClaims.data === null) {
        console.error(rawClaims);
        throw new Error("Failed to get claims");
      }

      claims = makePermissionsFromClaims(rawClaims.data as Json[]);

      await redis.set(getPermissionCacheKey(userId), JSON.stringify(claims));

      if (!claims) {
        throw new Error("Failed to get claims");
      }
    }

    return claims;
  }
}

export async function getUserGroups(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client.rpc("groups_for_user", { uid: userId });
}

function isClaimPermission(key: string, value: unknown) {
  const action = key.split("_")[1];
  return (
    action !== undefined &&
    ["view", "create", "update", "delete"].includes(action) &&
    Array.isArray(value)
  );
}

export function makePermissionsFromClaims(claims: Json[] | null) {
  if (typeof claims !== "object" || claims === null) return null;
  const permissions: Record<string, Permission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    if (isClaimPermission(key, value)) {
      const [module, action] = key.split("_");
      if (!(module in permissions)) {
        permissions[module] = {
          view: [],
          create: [],
          update: [],
          delete: []
        };
      }

      switch (action) {
        case "view":
          permissions[module].view = value as string[];
          break;
        case "create":
          permissions[module].create = value as string[];
          break;
        case "update":
          permissions[module].update = value as string[];
          break;
        case "delete":
          permissions[module].delete = value as string[];
          break;
      }
    }
  });

  if ("role" in claims) {
    role = claims.role as string;
  }

  if ("items" in permissions) {
    delete permissions.items;
  }

  return { permissions, role };
}
