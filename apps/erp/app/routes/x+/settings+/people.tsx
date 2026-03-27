import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  updateConsoleSetting,
  updateTimeCardSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "People",
  to: path.to.peopleSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return { companySettings: companySettings.data };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const enabled = formData.get("enabled") === "true";

  if (intent === "timeCard") {
    const update = await updateTimeCardSetting(client, companyId, enabled);
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Timecard settings updated" };
  }

  if (intent === "console") {
    const update = await updateConsoleSetting(client, companyId, enabled);
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Console mode settings updated" };
  }

  return { success: false, message: "Unknown intent" };
}

export default function PeopleSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isToggling = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  const handleConsoleToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "console", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleTimeCardToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "timeCard", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">People</Heading>

        <Card>
          <CardHeader>
            <CardTitle>Console Mode</CardTitle>
            <CardDescription>
              Enable shared workstation mode for MES terminals. Operators
              identify themselves via PIN before performing work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">
                  {(companySettings as any).consoleEnabled
                    ? "Console mode is enabled"
                    : "Console mode is disabled"}
                </span>
                <HStack className="items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {(companySettings as any).consoleEnabled
                      ? "Operators can use shared workstations with PIN authentication."
                      : "Enable to allow shared workstation mode."}
                  </span>
                  <Badge variant="yellow">Beta</Badge>
                </HStack>
              </VStack>
              <Switch
                checked={(companySettings as any).consoleEnabled ?? false}
                onCheckedChange={handleConsoleToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timecards</CardTitle>
            <CardDescription>
              Enable timecard tracking for work shifts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">
                  {companySettings.timeCardEnabled
                    ? "Timecards are enabled"
                    : "Timecards are disabled"}
                </span>
                <HStack className="items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {companySettings.timeCardEnabled
                      ? "Work shift tracking is active."
                      : "Enable to start tracking work shifts."}
                  </span>
                  <Badge variant="yellow">Beta</Badge>
                </HStack>
              </VStack>
              <Switch
                checked={companySettings.timeCardEnabled ?? false}
                onCheckedChange={handleTimeCardToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
