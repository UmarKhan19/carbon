import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
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
  updateMaterialGeneratedIdsSetting,
  updateMetricSettings
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.itemsSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings] = await Promise.all([
    getCompanySettings(client, companyId)
  ]);
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

  switch (intent) {
    case "materialIds": {
      const result = await updateMaterialGeneratedIdsSetting(
        client,
        companyId,
        enabled
      );
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Material IDs setting updated" };
    }

    case "materialUnits": {
      const result = await updateMetricSettings(client, companyId, enabled);
      if (result.error)
        return { success: false, message: result.error.message };
      return { success: true, message: "Material units setting updated" };
    }
  }

  return { success: false, message: "Invalid form data" };
}

export default function ItemsSettingsRoute() {
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

  const handleMaterialIdsToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "materialIds", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleMetricToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "materialUnits", enabled: String(checked) },
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
        <Heading size="h3">Items</Heading>
        <Card>
          <CardHeader>
            <CardTitle>Material IDs</CardTitle>
            <CardDescription>
              Generate material IDs and descriptions based on the properties of
              the material.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">
                  {companySettings.materialGeneratedIds
                    ? "Generated IDs are enabled"
                    : "Generated IDs are disabled"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.materialGeneratedIds
                    ? "IDs and descriptions are generated for raw materials."
                    : "Enable to generate IDs and descriptions for raw materials."}
                </span>
              </VStack>
              <Switch
                checked={companySettings.materialGeneratedIds ?? false}
                onCheckedChange={handleMaterialIdsToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Metric</CardTitle>
            <CardDescription>
              Use metric system for default material dimensions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">
                  {(companySettings as any).useMetric
                    ? "Metric units are enabled"
                    : "Metric units are disabled"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {(companySettings as any).useMetric
                    ? "Material dimensions use metric units."
                    : "Enable to use metric units for material dimensions."}
                </span>
              </VStack>
              <Switch
                checked={(companySettings as any).useMetric ?? false}
                onCheckedChange={handleMetricToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
