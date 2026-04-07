import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Boolean as BooleanField,
  Input,
  Select,
  Submit,
  ValidatedForm,
  validator
} from "@carbon/form";
import type { PrintingSettings } from "@carbon/printing";
import {
  deletePrinterRoute,
  documentTypeRegistry,
  getDocumentType,
  getDocumentTypeOptions,
  getPrinterRoutes,
  upsertPrinterRoute
} from "@carbon/printing";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { getLocationsList, getWorkCentersList } from "~/modules/resources";
import {
  assignmentSettingsValidator,
  autoPrintSettingsValidator,
  getCompanySettings,
  locationOverrideValidator,
  printerRouteValidator,
  workCenterOverrideValidator
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Printing",
  to: path.to.printingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, printerRoutes, workCenters, locations] =
    await Promise.all([
      getCompanySettings(client, companyId),
      getPrinterRoutes(client, companyId),
      getWorkCentersList(client, companyId),
      getLocationsList(client, companyId)
    ]);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );

  return {
    companySettings: companySettings.data,
    printerRoutes: printerRoutes.data ?? [],
    workCenters: workCenters.data ?? [],
    locations: locations.data ?? []
  };
}

function generateTestLabel(
  format: string,
  mediaSizeId: string | null
): string | null {
  if (format !== "zpl" || !mediaSizeId) return null;

  const labelSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!labelSize?.zpl) return null;

  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;
  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  const now = new Date();
  const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

  return [
    "^XA",
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    "^MNW",
    "^FO20,20^A0N,30,30^FDTest Print^FS",
    `^FO20,60^A0N,20,20^FD${mediaSizeId} — ${width}x${height}"^FS`,
    `^FO20,90^A0N,16,16^FD${timestamp}^FS`,
    "^XZ"
  ].join("\n");
}

const mediaSizeOptions = labelSizes.map((s) => ({
  value: s.id,
  label: `${s.name} (${s.description})`
}));

const formatOptions = [
  { value: "zpl", label: "ZPL (Thermal Label)" },
  { value: "pdf", label: "PDF (Document)" }
];

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "autoPrint": {
      const validation = await validator(autoPrintSettingsValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {};

      const settings: PrintingSettings = {
        ...current,
        autoPrint: {
          receiptLabels: validation.data.receiptLabels,
          shipmentLabels: validation.data.shipmentLabels,
          kanbanCards: validation.data.kanbanCards,
          operationLabels: validation.data.operationLabels
        }
      };

      const result = await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Auto-print settings updated" };
    }

    case "assignments": {
      const validation = await validator(assignmentSettingsValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {};

      const assignments: Record<
        string,
        { printerRouteId: string | null; templateId: string | null }
      > = {};
      for (const dt of documentTypeRegistry) {
        const printerRouteId =
          (validation.data as any)[`${dt.id}_printerRouteId`] || null;
        const templateId =
          (validation.data as any)[`${dt.id}_templateId`] || null;
        assignments[dt.id] = { printerRouteId, templateId };
      }

      const settings: PrintingSettings = {
        ...current,
        assignments
      };

      const result = await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Template assignments updated" };
    }

    case "upsertRoute": {
      const validation = await validator(printerRouteValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const result = await upsertPrinterRoute(client, {
        id: validation.data.id || undefined,
        companyId,
        name: validation.data.name,
        format: validation.data.format,
        mediaSizeId: validation.data.mediaSizeId || null,
        printerUrl: validation.data.printerUrl,
        apiKey: validation.data.apiKey || null,
        locationId: validation.data.locationId || null
      });

      if (result.error)
        return { success: false, message: result.error.message };

      return {
        success: true,
        message: validation.data.id
          ? "Printer route updated"
          : "Printer route created"
      };
    }

    case "deleteRoute": {
      const routeId = formData.get("routeId") as string;
      if (!routeId) return { success: false, message: "Route ID required" };

      const result = await deletePrinterRoute(client, routeId, companyId);
      if (result.error)
        return { success: false, message: result.error.message };

      // Clean up dangling references in printing settings
      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = existing?.printing as PrintingSettings | null;
      if (current) {
        let dirty = false;
        const settings = { ...current };

        // Clear assignments referencing this route
        if (settings.assignments) {
          const assignments = { ...settings.assignments };
          for (const [dtId, assignment] of Object.entries(assignments)) {
            if (assignment?.printerRouteId === routeId) {
              assignments[dtId] = { ...assignment, printerRouteId: null };
              dirty = true;
            }
          }
          settings.assignments = assignments;
        }

        // Clear location overrides referencing this route
        if (settings.locationOverrides) {
          const overrides = { ...settings.locationOverrides };
          for (const [locId, locOverride] of Object.entries(overrides)) {
            const cleaned = { ...locOverride };
            for (const [lt, prId] of Object.entries(cleaned)) {
              if (prId === routeId) {
                delete cleaned[lt as keyof typeof cleaned];
                dirty = true;
              }
            }
            if (Object.keys(cleaned).length === 0) {
              delete overrides[locId];
            } else {
              overrides[locId] = cleaned;
            }
          }
          settings.locationOverrides = overrides;
        }

        // Clear work center overrides referencing this route
        if (settings.workCenterOverrides) {
          const overrides = { ...settings.workCenterOverrides };
          for (const [wcId, wcOverride] of Object.entries(overrides)) {
            const cleaned = { ...wcOverride };
            for (const [lt, prId] of Object.entries(cleaned)) {
              if (prId === routeId) {
                delete cleaned[lt as keyof typeof cleaned];
                dirty = true;
              }
            }
            if (Object.keys(cleaned).length === 0) {
              delete overrides[wcId];
            } else {
              overrides[wcId] = cleaned;
            }
          }
          settings.workCenterOverrides = overrides;
        }

        if (dirty) {
          await client
            .from("companySettings")
            .update({ printing: JSON.parse(JSON.stringify(settings)) })
            .eq("id", companyId);
        }
      }

      return { success: true, message: "Printer route deleted" };
    }

    case "testPrint": {
      const routeId = formData.get("routeId") as string;
      if (!routeId) return { success: false, message: "Route ID required" };

      const { data: route } = await client
        .from("printerRoute")
        .select("printerUrl, format, mediaSizeId, apiKey")
        .eq("id", routeId)
        .eq("companyId", companyId)
        .single();

      if (!route) return { success: false, message: "Printer route not found" };

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/octet-stream"
        };
        if (route.apiKey) headers["X-API-Key"] = route.apiKey;

        const testLabel = generateTestLabel(route.format, route.mediaSizeId);

        if (!testLabel) {
          return {
            success: false,
            message:
              "Test print is only supported for ZPL label printers with a media size configured."
          };
        }

        const response = await fetch(route.printerUrl, {
          method: "POST",
          headers,
          body: testLabel,
          signal: AbortSignal.timeout(10_000)
        });

        if (!response.ok) {
          return {
            success: false,
            message: `Print failed (${response.status} ${response.statusText})`
          };
        }

        return { success: true, message: "Test label sent to printer" };
      } catch (err) {
        return {
          success: false,
          message: `Print failed: ${err instanceof Error ? err.message : "Unknown error"}`
        };
      }
    }

    case "addLocationOverride": {
      const validation = await validator(locationOverrideValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "All fields are required" };
      }

      const { locationId, documentType, printerRouteId } = validation.data;

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {};
      const overrides = { ...current.locationOverrides };
      overrides[locationId] = {
        ...overrides[locationId],
        [documentType]: printerRouteId
      };

      const settings: PrintingSettings = {
        ...current,
        locationOverrides: overrides
      };

      const result = await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Location override added" };
    }

    case "deleteLocationOverride": {
      const locationId = formData.get("locationId") as string;
      const documentType = formData.get("documentType") as string;

      if (!locationId || !documentType) {
        return { success: false, message: "Missing fields" };
      }

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {};
      const overrides = { ...current.locationOverrides };

      if (overrides[locationId]) {
        const locOverride = { ...overrides[locationId] };
        delete locOverride[documentType as keyof typeof locOverride];
        if (Object.keys(locOverride).length === 0) {
          delete overrides[locationId];
        } else {
          overrides[locationId] = locOverride;
        }
      }

      const settings: PrintingSettings = {
        ...current,
        locationOverrides: overrides
      };

      const result = await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Location override removed" };
    }

    case "addOverride": {
      const validation = await validator(workCenterOverrideValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "All fields are required" };
      }

      const { workCenterId, documentType, printerRouteId } = validation.data;

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {};
      const overrides = { ...current.workCenterOverrides };
      overrides[workCenterId] = {
        ...overrides[workCenterId],
        [documentType]: printerRouteId
      };

      const settings: PrintingSettings = {
        ...current,
        workCenterOverrides: overrides
      };

      const result = await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Work center override added" };
    }

    case "deleteOverride": {
      const workCenterId = formData.get("workCenterId") as string;
      const documentType = formData.get("documentType") as string;

      if (!workCenterId || !documentType) {
        return { success: false, message: "Missing fields" };
      }

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {};
      const overrides = { ...current.workCenterOverrides };

      if (overrides[workCenterId]) {
        const wcOverride = { ...overrides[workCenterId] };
        delete wcOverride[documentType as keyof typeof wcOverride];
        if (Object.keys(wcOverride).length === 0) {
          delete overrides[workCenterId];
        } else {
          overrides[workCenterId] = wcOverride;
        }
      }

      const settings: PrintingSettings = {
        ...current,
        workCenterOverrides: overrides
      };

      const result = await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Work center override removed" };
    }
  }

  return { success: false, message: "Unknown intent" };
}

export default function PrintingSettingsRoute() {
  const { companySettings, printerRoutes, workCenters, locations } =
    useLoaderData<typeof loader>();
  const autoPrintFetcher = useFetcher<typeof action>();
  const routeFetcher = useFetcher<typeof action>();
  const assignmentFetcher = useFetcher<typeof action>();
  const locationOverrideFetcher = useFetcher<typeof action>();
  const overrideFetcher = useFetcher<typeof action>();

  const printing = companySettings.printing as PrintingSettings | null;

  const printerRouteOptions = printerRoutes.map((r) => ({
    value: r.id,
    label: r.name
  }));

  const workCenterOptions = workCenters.map((wc) => ({
    value: wc.id,
    label: wc.name
  }));

  const locationOptions = locations.map((loc) => ({
    value: loc.id,
    label: loc.name
  }));

  const documentTypeOptions = getDocumentTypeOptions();

  const printerRouteMap = new Map(printerRoutes.map((r) => [r.id, r.name]));
  const workCenterMap = new Map(workCenters.map((wc) => [wc.id, wc.name]));
  const locationMap = new Map(locations.map((loc) => [loc.id, loc.name]));

  const assignmentDefaults: Record<string, string> = {};
  for (const dt of documentTypeRegistry) {
    assignmentDefaults[`${dt.id}_printerRouteId`] =
      printing?.assignments?.[dt.id]?.printerRouteId ?? "";
    assignmentDefaults[`${dt.id}_templateId`] =
      printing?.assignments?.[dt.id]?.templateId ?? "";
  }

  useEffect(() => {
    if (
      autoPrintFetcher.data?.success === true &&
      autoPrintFetcher.data?.message
    ) {
      toast.success(autoPrintFetcher.data.message);
    }
    if (
      autoPrintFetcher.data?.success === false &&
      autoPrintFetcher.data?.message
    ) {
      toast.error(autoPrintFetcher.data.message);
    }
  }, [autoPrintFetcher.data?.message, autoPrintFetcher.data?.success]);

  useEffect(() => {
    if (routeFetcher.data?.success === true && routeFetcher.data?.message) {
      toast.success(routeFetcher.data.message);
    }
    if (routeFetcher.data?.success === false && routeFetcher.data?.message) {
      toast.error(routeFetcher.data.message);
    }
  }, [routeFetcher.data?.message, routeFetcher.data?.success]);

  useEffect(() => {
    if (
      assignmentFetcher.data?.success === true &&
      assignmentFetcher.data?.message
    ) {
      toast.success(assignmentFetcher.data.message);
    }
    if (
      assignmentFetcher.data?.success === false &&
      assignmentFetcher.data?.message
    ) {
      toast.error(assignmentFetcher.data.message);
    }
  }, [assignmentFetcher.data?.message, assignmentFetcher.data?.success]);

  useEffect(() => {
    if (
      locationOverrideFetcher.data?.success === true &&
      locationOverrideFetcher.data?.message
    ) {
      toast.success(locationOverrideFetcher.data.message);
    }
    if (
      locationOverrideFetcher.data?.success === false &&
      locationOverrideFetcher.data?.message
    ) {
      toast.error(locationOverrideFetcher.data.message);
    }
  }, [
    locationOverrideFetcher.data?.message,
    locationOverrideFetcher.data?.success
  ]);

  useEffect(() => {
    if (
      overrideFetcher.data?.success === true &&
      overrideFetcher.data?.message
    ) {
      toast.success(overrideFetcher.data.message);
    }
    if (
      overrideFetcher.data?.success === false &&
      overrideFetcher.data?.message
    ) {
      toast.error(overrideFetcher.data.message);
    }
  }, [overrideFetcher.data?.message, overrideFetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Printing</Heading>

        {/* Auto-Print Settings */}
        <Card>
          <ValidatedForm
            method="post"
            validator={autoPrintSettingsValidator}
            defaultValues={{
              receiptLabels: printing?.autoPrint?.receiptLabels ?? false,
              shipmentLabels: printing?.autoPrint?.shipmentLabels ?? false,
              kanbanCards: printing?.autoPrint?.kanbanCards ?? false,
              operationLabels: printing?.autoPrint?.operationLabels ?? false
            }}
            fetcher={autoPrintFetcher}
          >
            <input type="hidden" name="intent" value="autoPrint" />
            <CardHeader>
              <CardTitle>Auto-Print</CardTitle>
              <CardDescription>
                Automatically print labels when business events occur.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 max-w-[400px]">
                <BooleanField
                  name="receiptLabels"
                  description="Print labels when receipts are posted"
                />
                <BooleanField
                  name="shipmentLabels"
                  description="Print labels when shipments are posted"
                />
                <BooleanField
                  name="kanbanCards"
                  description="Print kanban cards when triggered"
                />
                <BooleanField
                  name="operationLabels"
                  description="Print labels when operations complete"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        {/* Printer Routes */}
        <Card>
          <CardHeader>
            <CardTitle>Printers</CardTitle>
            <CardDescription>
              Configure physical printers. Each printer has a format, media
              size, and endpoint URL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {printerRoutes.length > 0 ? (
              <div className="flex flex-col gap-4">
                {printerRoutes.map((route) => (
                  <div
                    key={route.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-sm font-medium">
                            {route.name}
                          </span>
                          <span className="text-xs text-muted-foreground uppercase">
                            {route.format}
                          </span>
                          {route.mediaSizeId && (
                            <span className="text-xs text-muted-foreground">
                              {route.mediaSizeId}
                            </span>
                          )}
                          {route.locationId && (
                            <span className="text-xs text-muted-foreground">
                              {locationMap.get(route.locationId) ??
                                route.locationId}
                            </span>
                          )}
                          {route.apiKey && (
                            <span className="text-xs text-muted-foreground">
                              API Key: ••••••
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-sm text-muted-foreground break-all">
                          {route.printerUrl}
                        </div>
                      </div>
                      <HStack className="gap-1 shrink-0">
                        <routeFetcher.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="testPrint"
                          />
                          <input
                            type="hidden"
                            name="routeId"
                            value={route.id}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            Test
                          </Button>
                        </routeFetcher.Form>
                        <routeFetcher.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="deleteRoute"
                          />
                          <input
                            type="hidden"
                            name="routeId"
                            value={route.id}
                          />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                          >
                            Delete
                          </Button>
                        </routeFetcher.Form>
                      </HStack>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No printers configured. Add one below.
              </p>
            )}
          </CardContent>
          <CardFooter className="border-t pt-6">
            <ValidatedForm
              method="post"
              validator={printerRouteValidator}
              fetcher={routeFetcher}
              className="w-full"
              defaultValues={{ format: "zpl" }}
            >
              <input type="hidden" name="intent" value="upsertRoute" />
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    name="name"
                    label="Name"
                    placeholder="e.g. Zebra 2x1"
                  />
                  <Select
                    name="format"
                    label="Format"
                    options={formatOptions}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    name="mediaSizeId"
                    label="Media Size"
                    options={mediaSizeOptions}
                  />
                  <Select
                    name="locationId"
                    label="Location"
                    options={locationOptions}
                    placeholder="All locations"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    name="printerUrl"
                    label="Printer URL"
                    placeholder="https://pbx-XXXX.pbxz.cloud/api/v1/print/..."
                  />
                  <Input name="apiKey" label="API Key" placeholder="Optional" />
                </div>
                <div className="flex justify-end">
                  <Submit>Add Printer</Submit>
                </div>
              </div>
            </ValidatedForm>
          </CardFooter>
        </Card>

        {/* Template Assignments */}
        <Card>
          <ValidatedForm
            method="post"
            validator={assignmentSettingsValidator}
            defaultValues={assignmentDefaults}
            fetcher={assignmentFetcher}
          >
            <input type="hidden" name="intent" value="assignments" />
            <CardHeader>
              <CardTitle>Template Assignments</CardTitle>
              <CardDescription>
                Assign each document type to a printer and choose the generation
                template. Leave template blank for the built-in generator, or
                enter a BinderyPress template ID.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-6">
                {documentTypeRegistry.map((dt) => (
                  <AssignmentRow
                    key={dt.id}
                    title={dt.displayName}
                    prefix={dt.id}
                    printerRouteOptions={printerRouteOptions}
                  />
                ))}
              </div>
            </CardContent>
            <CardFooter>
              <Submit>Save</Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        {/* Location Overrides */}
        <Card>
          <CardHeader>
            <CardTitle>Location Overrides</CardTitle>
            <CardDescription>
              Override the default printer for specific locations. The
              generation template from the template assignment is preserved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {printing?.locationOverrides &&
            Object.keys(printing.locationOverrides).length > 0 ? (
              <div className="flex flex-col gap-2 mb-6">
                {Object.entries(printing.locationOverrides).flatMap(
                  ([locId, overrides]) =>
                    Object.entries(overrides).map(
                      ([docType, printerRouteId]) => (
                        <div
                          key={`${locId}-${docType}`}
                          className="flex items-center justify-between rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-medium">
                              {locationMap.get(locId) ?? locId}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-muted-foreground">
                              {getDocumentType(docType)?.displayName ?? docType}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span>
                              {printerRouteMap.get(printerRouteId) ??
                                printerRouteId}
                            </span>
                          </div>
                          <locationOverrideFetcher.Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="deleteLocationOverride"
                            />
                            <input
                              type="hidden"
                              name="locationId"
                              value={locId}
                            />
                            <input
                              type="hidden"
                              name="documentType"
                              value={docType}
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              Remove
                            </Button>
                          </locationOverrideFetcher.Form>
                        </div>
                      )
                    )
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-6">
                No location overrides configured.
              </p>
            )}
            <ValidatedForm
              method="post"
              validator={locationOverrideValidator}
              fetcher={locationOverrideFetcher}
              className="w-full"
            >
              <input type="hidden" name="intent" value="addLocationOverride" />
              <div className="flex items-end gap-4">
                <div className="flex-1 grid grid-cols-3 gap-4">
                  <Select
                    name="locationId"
                    label="Location"
                    options={locationOptions}
                  />
                  <Select
                    name="documentType"
                    label="Document Type"
                    options={documentTypeOptions}
                  />
                  <Select
                    name="printerRouteId"
                    label="Printer"
                    options={printerRouteOptions}
                  />
                </div>
                <Submit>Add Override</Submit>
              </div>
            </ValidatedForm>
          </CardContent>
        </Card>

        {/* Work Center Overrides */}
        <Card>
          <CardHeader>
            <CardTitle>Work Center Overrides</CardTitle>
            <CardDescription>
              Override the default printer for specific work centers. The
              generation template from the template assignment is preserved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {printing?.workCenterOverrides &&
            Object.keys(printing.workCenterOverrides).length > 0 ? (
              <div className="flex flex-col gap-2 mb-6">
                {Object.entries(printing.workCenterOverrides).flatMap(
                  ([wcId, overrides]) =>
                    Object.entries(overrides).map(
                      ([docType, printerRouteId]) => (
                        <div
                          key={`${wcId}-${docType}`}
                          className="flex items-center justify-between rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-medium">
                              {workCenterMap.get(wcId) ?? wcId}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-muted-foreground">
                              {getDocumentType(docType)?.displayName ?? docType}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span>
                              {printerRouteMap.get(printerRouteId) ??
                                printerRouteId}
                            </span>
                          </div>
                          <overrideFetcher.Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="deleteOverride"
                            />
                            <input
                              type="hidden"
                              name="workCenterId"
                              value={wcId}
                            />
                            <input
                              type="hidden"
                              name="documentType"
                              value={docType}
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              Remove
                            </Button>
                          </overrideFetcher.Form>
                        </div>
                      )
                    )
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-6">
                No work center overrides configured.
              </p>
            )}
            <ValidatedForm
              method="post"
              validator={workCenterOverrideValidator}
              fetcher={overrideFetcher}
              className="w-full"
            >
              <input type="hidden" name="intent" value="addOverride" />
              <div className="flex items-end gap-4">
                <div className="flex-1 grid grid-cols-3 gap-4">
                  <Select
                    name="workCenterId"
                    label="Work Center"
                    options={workCenterOptions}
                  />
                  <Select
                    name="documentType"
                    label="Document Type"
                    options={documentTypeOptions}
                  />
                  <Select
                    name="printerRouteId"
                    label="Printer"
                    options={printerRouteOptions}
                  />
                </div>
                <Submit>Add Override</Submit>
              </div>
            </ValidatedForm>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}

function AssignmentRow({
  title,
  prefix,
  printerRouteOptions
}: {
  title: string;
  prefix: string;
  printerRouteOptions: { value: string; label: string }[];
}) {
  return (
    <div>
      <p className="text-sm font-medium mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-4">
        <Select
          name={`${prefix}_printerRouteId`}
          label="Printer"
          options={printerRouteOptions}
        />
        <Input
          name={`${prefix}_templateId`}
          label="Template"
          placeholder="Leave blank for built-in"
        />
      </div>
    </div>
  );
}
