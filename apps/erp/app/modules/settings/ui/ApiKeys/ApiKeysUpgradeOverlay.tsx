import { Button, Card, CardContent, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuKeyRound } from "react-icons/lu";
import { Link } from "react-router";
import type { ApiKey } from "~/modules/settings";
import { path } from "~/utils/path";
import ApiKeysTable from "./ApiKeysTable";

const mockApiKeys: ApiKey[] = [
  {
    id: "mock-1",
    name: "Production",
    keyHash: "",
    keyPreview: "a1b2",
    scopes: {
      sales: ["read", "write"],
      purchasing: ["read"],
      inventory: ["read", "write"],
      production: ["read"]
    } as any,
    rateLimit: 60,
    rateLimitWindow: "1m",
    expiresAt: null,
    lastUsedAt: new Date().toISOString(),
    createdAt: "2026-01-15T10:00:00Z",
    createdBy: "mock-user-1",
    companyId: "mock"
  },
  {
    id: "mock-2",
    name: "Staging",
    keyHash: "",
    keyPreview: "9c4e",
    scopes: {
      sales: ["read"],
      inventory: ["read"]
    } as any,
    rateLimit: 60,
    rateLimitWindow: "1m",
    expiresAt: "2026-12-31T23:59:59Z",
    lastUsedAt: "2026-04-30T15:22:00Z",
    createdAt: "2026-02-01T09:30:00Z",
    createdBy: "mock-user-1",
    companyId: "mock"
  },
  {
    id: "mock-3",
    name: "CI Pipeline",
    keyHash: "",
    keyPreview: "f0a1",
    scopes: {
      production: ["read"]
    } as any,
    rateLimit: 30,
    rateLimitWindow: "1m",
    expiresAt: null,
    lastUsedAt: "2026-05-05T08:10:00Z",
    createdAt: "2026-02-10T11:45:00Z",
    createdBy: "mock-user-2",
    companyId: "mock"
  },
  {
    id: "mock-4",
    name: "Reporting",
    keyHash: "",
    keyPreview: "7d2b",
    scopes: {
      sales: ["read"],
      purchasing: ["read"]
    } as any,
    rateLimit: 10,
    rateLimitWindow: "1m",
    expiresAt: "2026-06-15T00:00:00Z",
    lastUsedAt: null,
    createdAt: "2026-03-20T14:00:00Z",
    createdBy: "mock-user-2",
    companyId: "mock"
  }
];

export default function ApiKeysUpgradeOverlay() {
  return (
    <div className="relative w-full h-full">
      <div
        className="blur-[2px] pointer-events-none select-none w-full h-full"
        aria-hidden="true"
      >
        <ApiKeysTable data={mockApiKeys} count={mockApiKeys.length} />
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <Card className="max-w-md shadow-lg">
          <CardContent className="flex flex-col items-center text-center gap-4 pt-6">
            <div className="rounded-full bg-muted p-3">
              <LuKeyRound className="size-6 text-muted-foreground" />
            </div>
            <VStack className="gap-2 items-center">
              <h3 className="text-lg font-semibold">
                <Trans>API Keys</Trans>
              </h3>
              <p className="text-sm text-muted-foreground text-balance">
                <Trans>
                  Issue scoped API keys for programmatic access to your Carbon
                  data.
                </Trans>
              </p>
            </VStack>
            <Button asChild>
              <Link to={path.to.billing}>
                <Trans>Upgrade to Business</Trans>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
