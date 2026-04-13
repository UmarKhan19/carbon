import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, Select, Submit, ValidatedForm, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  Label,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { Users } from "~/components/Form";
import {
  getCompanySettings,
  kanbanOutputTypes,
  kanbanOutputValidator,
  updateKanbanOutputSetting
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Inventory`,
  to: path.to.inventorySettings
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

const shelfLifeNotificationValidator = z.object({
  intent: z.literal("shelfLifeNotification"),
  shelfLifeExpiryNotificationGroup: z.array(z.string()).optional()
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "kanbanOutput": {
      const kanbanOutputValidation = await validator(
        kanbanOutputValidator
      ).validate(formData);

      if (kanbanOutputValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const kanbanOutputResult = await updateKanbanOutputSetting(
        client,
        companyId,
        kanbanOutputValidation.data.kanbanOutput
      );
      if (kanbanOutputResult.error)
        return {
          success: false,
          message: kanbanOutputResult.error.message
        };

      return { success: true, message: "Kanban output setting updated" };
    }

    case "shelfLifeNotification": {
      const validation = await validator(
        shelfLifeNotificationValidator
      ).validate(formData);

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const update = await client
        .from("companySettings")
        // @ts-ignore - column added in shelf-life migration, types not yet regenerated
        .update({
          shelfLifeExpiryNotificationGroup:
            validation.data.shelfLifeExpiryNotificationGroup ?? []
        })
        .eq("id", companyId);

      if (update.error)
        return { success: false, message: update.error.message };

      return {
        success: true,
        message: "Shelf life notification settings updated"
      };
    }
  }

  return { success: false, message: "Invalid form data" };
}

const outputLabels: Record<(typeof kanbanOutputTypes)[number], string> = {
  label: "Label",
  qrcode: "QR Code",
  url: "URL"
};

export default function InventorySettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Inventory</Trans>
        </Heading>
        <Card>
          <ValidatedForm
            method="post"
            validator={kanbanOutputValidator}
            defaultValues={{
              kanbanOutput: companySettings.kanbanOutput ?? "qrcode"
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Kanban Output</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Style of kanban output to show in the Kanban table
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="kanbanOutput" />
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Select
                    name="kanbanOutput"
                    label={t`Output`}
                    options={kanbanOutputTypes.map((type) => ({
                      value: type,
                      label: outputLabels[type]
                    }))}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <Card>
          <ValidatedForm
            method="post"
            validator={shelfLifeNotificationValidator}
            defaultValues={{
              intent: "shelfLifeNotification" as const,
              // @ts-ignore - column added in shelf-life migration, types not yet regenerated
              shelfLifeExpiryNotificationGroup:
                // @ts-ignore
                companySettings.shelfLifeExpiryNotificationGroup ?? []
            }}
            fetcher={fetcher}
          >
            <Hidden name="intent" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Near-Expiry Notifications
              </CardTitle>
              <CardDescription>
                Configure who receives alerts when batch/serial inventory is
                approaching its expiration date. Notifications are sent at 14,
                7, 3, and 1 day(s) before expiration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Label>Expiry Alert Recipients</Label>
                  <Users
                    name="shelfLifeExpiryNotificationGroup"
                    label="Who should receive notifications when inventory is near expiry?"
                    type="employee"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
