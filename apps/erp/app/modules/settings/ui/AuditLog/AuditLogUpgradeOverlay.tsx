import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Switch,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuHistory } from "react-icons/lu";
import { UpgradeOverlay } from "~/components/UpgradeOverlay";

export default function AuditLogUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlay.Preview>
        <VStack
          spacing={4}
          className="py-12 px-4 max-w-[60rem] mx-auto gap-4"
        >
          <Card>
            <CardHeader>
              <CardTitle>Audit Logging</CardTitle>
              <CardDescription>
                Track changes to key business entities including invoices,
                orders, customers, suppliers, and more.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HStack className="justify-between items-center">
                <VStack className="items-start gap-1">
                  <span className="font-medium">Audit logging is disabled</span>
                  <span className="text-sm text-muted-foreground">
                    Enable to start tracking changes to your data.
                  </span>
                </VStack>
                <Switch checked={false} disabled />
              </HStack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archived Logs</CardTitle>
              <CardDescription>
                Logs older than 30 days are automatically archived.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack className="gap-2">
                {[1, 2].map((i) => (
                  <HStack
                    key={i}
                    className="justify-between items-center p-6 border rounded-md w-full"
                  >
                    <VStack className="items-start">
                      <span className="font-medium text-sm">
                        Jan 1, 2026 - Jan 31, 2026
                      </span>
                      <span className="text-xs text-muted-foreground">
                        1,234 records (2.1 MB)
                      </span>
                    </VStack>
                    <div className="h-8 w-24 rounded bg-muted" />
                  </HStack>
                ))}
              </VStack>
            </CardContent>
          </Card>
        </VStack>
      </UpgradeOverlay.Preview>
      <UpgradeOverlay.Card>
        <UpgradeOverlay.Icon>
          <LuHistory className="size-6 text-muted-foreground" />
        </UpgradeOverlay.Icon>
        <UpgradeOverlay.Content>
          <UpgradeOverlay.Title>
            <Trans>Audit Logs</Trans>
          </UpgradeOverlay.Title>
          <UpgradeOverlay.Description>
            <Trans>
              Track every change to your orders, invoices, customers,
              suppliers, and more.
            </Trans>
          </UpgradeOverlay.Description>
        </UpgradeOverlay.Content>
        <UpgradeOverlay.Actions>
          <UpgradeOverlay.UpgradeButton />
        </UpgradeOverlay.Actions>
      </UpgradeOverlay.Card>
    </UpgradeOverlay>
  );
}
