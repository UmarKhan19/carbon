import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Boolean,
  Hidden,
  Number,
  Select,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  kanbanOutputTypes,
  kanbanOutputValidator,
  shelfLifeSettingsValidator,
  updateKanbanOutputSetting,
  updateShelfLifeSettings
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "kanbanOutput":
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

    case "shelfLife":
      const shelfLifeValidation = await validator(
        shelfLifeSettingsValidator
      ).validate(formData);

      if (shelfLifeValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const shelfLifeResult = await updateShelfLifeSettings(client, companyId, {
        nearExpiryWarningDays: shelfLifeValidation.data.nearExpiryWarningDays,
        expiredBadgeEnabled: shelfLifeValidation.data.expiredBadgeEnabled
      });
      if (shelfLifeResult.error)
        return {
          success: false,
          message: shelfLifeResult.error.message
        };

      return {
        success: true,
        message: "Shelf life & expiry settings updated"
      };
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
            validator={shelfLifeSettingsValidator}
            defaultValues={{
              nearExpiryWarningDays:
                companySettings.nearExpiryWarningDays ?? 14,
              expiredBadgeEnabled: companySettings.expiredBadgeEnabled ?? true
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Shelf life & expiry</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Controls how near-expiry and expired batches are surfaced
                  throughout the app. Warn-only — these settings do not block
                  consumption or receipt.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="shelfLife" />
              <div className="flex flex-col gap-4 max-w-[400px]">
                <Number
                  name="nearExpiryWarningDays"
                  label={t`"Expiring soon" threshold (days)`}
                  minValue={0}
                  maxValue={365}
                  helperText={t`Batches whose expiry falls within this many days from today get the amber badge.`}
                />
                <Boolean
                  name="expiredBadgeEnabled"
                  label={t`Show expired badge`}
                  description={t`When off, batches past their expiry date will no longer display a red "Expired" badge.`}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
