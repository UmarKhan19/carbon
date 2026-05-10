import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Input, Select, Submit, ValidatedForm, validator } from "@carbon/form";
import type { LocationAssignment, PrintingSettings } from "@carbon/printing";
import {
  getPrinterRoutes,
  updateAssignmentValidator,
  upsertPrinterRoute
} from "@carbon/printing";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
  Switch,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuHandCoins,
  LuMapPin,
  LuPlay,
  LuPlus,
  LuPrinter,
  LuTrash,
  LuTruck,
  LuWrench
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData
} from "react-router";
import { Empty } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { getLocationsList, getWorkCentersList } from "~/modules/resources";
import { getCompanySettings, printerRouteValidator } from "~/modules/settings";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Printing",
  to: path.to.printingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, printerRoutes, workCenters, locations, userDefaults] =
    await Promise.all([
      getCompanySettings(client, companyId),
      getPrinterRoutes(client, companyId),
      getWorkCentersList(client, companyId),
      getLocationsList(client, companyId),
      getUserDefaults(client, userId, companyId)
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
    locations: locations.data ?? [],
    defaultLocationId: userDefaults.data?.locationId ?? null
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
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
        locationId: validation.data.locationId || null,
        templateId: validation.data.templateId || null
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

    case "updateAssignment": {
      const validation = await validator(updateAssignmentValidator).validate(
        formData
      );

      if (validation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const { locationId, context, contextId, printerRouteId, autoPrint } =
        validation.data;

      const { data: existing } = await client
        .from("companySettings")
        .select("printing")
        .eq("id", companyId)
        .single();

      const current = (existing?.printing as PrintingSettings | null) ?? {
        assignments: {}
      };
      const assignments = { ...current.assignments };

      const emptyContext = { printerRouteId: null, autoPrint: false };
      const locationAssignment: LocationAssignment = assignments[locationId]
        ? { ...assignments[locationId] }
        : {
            defaultPrinterRouteId: null,
            defaultAutoPrint: false,
            shipping: { ...emptyContext },
            receiving: { ...emptyContext },
            workCenters: {}
          };

      switch (context) {
        case "default":
          locationAssignment.defaultPrinterRouteId = printerRouteId || null;
          locationAssignment.defaultAutoPrint = autoPrint;
          break;
        case "shipping":
          locationAssignment.shipping = {
            printerRouteId: printerRouteId || null,
            autoPrint
          };
          break;
        case "receiving":
          locationAssignment.receiving = {
            printerRouteId: printerRouteId || null,
            autoPrint
          };
          break;
        case "workCenter":
          if (contextId) {
            locationAssignment.workCenters = {
              ...locationAssignment.workCenters,
              [contextId]: {
                printerRouteId: printerRouteId || null,
                autoPrint
              }
            };
          }
          break;
      }

      assignments[locationId] = locationAssignment;

      const result = await client
        .from("companySettings")
        .update({
          printing: JSON.parse(JSON.stringify({ ...current, assignments }))
        })
        .eq("id", companyId);

      if (result.error)
        return { success: false, message: result.error.message };

      return { success: true, message: "Assignment updated" };
    }
  }

  return { success: false, message: "Unknown intent" };
}

export default function PrintingSettingsRoute() {
  const { companySettings, printerRoutes, workCenters, locations } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const routeFetcher = useFetcher<typeof action>();
  const assignmentFetcher = useFetcher<typeof action>();

  const formatOptions = [
    { value: "zpl", label: t`ZPL (Thermal Label)` },
    { value: "pdf", label: t`PDF (Document)` }
  ];

  const newPrinterDisclosure = useDisclosure();
  const deletePrinterDisclosure = useDisclosure();
  const [printerToDelete, setPrinterToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const printing = companySettings.printing as PrintingSettings | null;

  const printerRouteOptions = useMemo(
    () => [
      { value: "", label: t`None` },
      ...printerRoutes.map((r) => ({
        value: r.id,
        label: r.name
      }))
    ],
    [printerRoutes, t]
  );

  const printerRouteMap = useMemo(
    () => new Map(printerRoutes.map((r) => [r.id, r.name])),
    [printerRoutes]
  );

  const workCentersByLocation = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; locationId: string | null }[]
    >();
    for (const wc of workCenters) {
      if (!wc.locationId) continue;
      const existing = map.get(wc.locationId) ?? [];
      existing.push(wc);
      map.set(wc.locationId, existing);
    }
    return map;
  }, [workCenters]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: we don't need to re-run this effect when onClose changes
  useEffect(() => {
    if (routeFetcher.data?.success === true && routeFetcher.data?.message) {
      toast.success(routeFetcher.data.message);
      newPrinterDisclosure.onClose();
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

  const submitAssignment = useCallback(
    (data: {
      locationId: string;
      context: string;
      contextId?: string;
      printerRouteId?: string;
      autoPrint?: boolean;
    }) => {
      const formData = new FormData();
      formData.set("intent", "updateAssignment");
      formData.set("locationId", data.locationId);
      formData.set("context", data.context);
      if (data.contextId) formData.set("contextId", data.contextId);
      if (data.printerRouteId)
        formData.set("printerRouteId", data.printerRouteId);
      if (data.autoPrint) formData.set("autoPrint", "on");
      assignmentFetcher.submit(formData, { method: "POST" });
    },
    [assignmentFetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <div className="flex items-center justify-between w-full">
          <Heading size="h3">
            <Trans>Printing</Trans>
          </Heading>
          <Button leftIcon={<LuPrinter />} asChild>
            <Link to={path.to.printingSettingsJobs}>
              <Trans>View Prints</Trans>
            </Link>
          </Button>
        </div>

        {/* Printers */}
        <Card>
          <HStack className="w-full justify-between items-start">
            <CardHeader>
              <CardTitle>
                <Trans>Printers</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Physical printers available for assignment.</Trans>
              </CardDescription>
            </CardHeader>
            <CardAction className="py-6">
              <Button
                leftIcon={<LuPlus />}
                onClick={newPrinterDisclosure.onOpen}
              >
                <Trans>Add Printer</Trans>
              </Button>
            </CardAction>
          </HStack>
          <CardContent>
            {printerRoutes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {printerRoutes.map((route) => (
                  <div
                    key={route.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-medium">{route.name}</span>
                      <span className="text-xs text-muted-foreground uppercase">
                        {route.format}
                      </span>
                      {route.mediaSizeId && (
                        <span className="text-xs text-muted-foreground">
                          {route.mediaSizeId}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                        {route.printerUrl}
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`More`}
                          icon={<LuEllipsisVertical />}
                          variant="ghost"
                          size="sm"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            routeFetcher.submit(
                              { intent: "testPrint", routeId: route.id },
                              { method: "POST" }
                            )
                          }
                        >
                          <DropdownMenuIcon icon={<LuPlay />} />
                          <Trans>Test</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          onSelect={() => {
                            setPrinterToDelete({
                              id: route.id,
                              name: route.name
                            });
                            deletePrinterDisclosure.onOpen();
                          }}
                        >
                          <DropdownMenuIcon icon={<LuTrash />} />
                          <Trans>Delete</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                <p className="text-sm text-muted-foreground mt-10">
                  <Trans>
                    No printers configured. Click "Add Printer" to create one.
                  </Trans>
                </p>
              </Empty>
            )}
          </CardContent>
        </Card>

        {/* Assignments */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Assignments</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Assign printers to locations. Shipping, receiving, and work
                centers inherit the location default unless overridden.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {locations.length > 0 ? (
              <div className="flex flex-col">
                {locations.map((location) => {
                  const assignment = printing?.assignments?.[location.id];
                  const locationWCs =
                    workCentersByLocation.get(location.id) ?? [];

                  return (
                    <LocationSection
                      key={location.id}
                      locationId={location.id}
                      locationName={location.name}
                      assignment={assignment ?? null}
                      workCenters={locationWCs}
                      printerRouteOptions={printerRouteOptions}
                      printerRouteMap={printerRouteMap}
                      onUpdate={submitAssignment}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>No locations found.</Trans>
              </p>
            )}
          </CardContent>
        </Card>
      </VStack>

      {newPrinterDisclosure.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) newPrinterDisclosure.onClose();
          }}
        >
          <ModalContent size="large">
            <ValidatedForm
              method="post"
              validator={printerRouteValidator}
              fetcher={routeFetcher}
              defaultValues={{ format: "zpl" }}
              className="flex flex-col h-full"
            >
              <input type="hidden" name="intent" value="upsertRoute" />
              <ModalHeader>
                <ModalTitle>
                  <Trans>Add Printer</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      name="name"
                      label={t`Name`}
                      placeholder={t`e.g. Zebra 2x1`}
                    />
                    <Select
                      name="format"
                      label={t`Format`}
                      options={formatOptions}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      name="mediaSizeId"
                      label={t`Media Size`}
                      options={mediaSizeOptions}
                    />
                    <Input
                      name="templateId"
                      label={t`Template ID`}
                      placeholder={t`Leave blank for built-in`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      name="printerUrl"
                      label={t`Printer URL`}
                      placeholder="https://pbx-XXXX.pbxz.cloud/api/v1/print/..."
                    />
                    <Input
                      name="apiKey"
                      label={t`API Key`}
                      placeholder={t`Optional`}
                    />
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <HStack>
                  <Button
                    size="md"
                    variant="solid"
                    onClick={newPrinterDisclosure.onClose}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                  <Submit>
                    <Trans>Add Printer</Trans>
                  </Submit>
                </HStack>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {deletePrinterDisclosure.isOpen && printerToDelete && (
        <ConfirmDelete
          action={path.to.deletePrinterRoute(printerToDelete.id)}
          isOpen={deletePrinterDisclosure.isOpen}
          name={printerToDelete.name}
          text={t`Are you sure you want to delete the printer "${printerToDelete.name}"? Any assignments referencing this printer will be cleared. This cannot be undone.`}
          onCancel={() => {
            deletePrinterDisclosure.onClose();
            setPrinterToDelete(null);
          }}
          onSubmit={() => {
            deletePrinterDisclosure.onClose();
            setPrinterToDelete(null);
          }}
        />
      )}
      <Outlet />
    </ScrollArea>
  );
}

function LocationSection({
  locationId,
  locationName,
  assignment,
  workCenters,
  printerRouteOptions,
  printerRouteMap,
  onUpdate
}: {
  locationId: string;
  locationName: string;
  assignment: LocationAssignment | null;
  workCenters: { id: string; name: string }[];
  printerRouteOptions: { value: string; label: string }[];
  printerRouteMap: Map<string, string>;
  onUpdate: (data: {
    locationId: string;
    context: string;
    contextId?: string;
    printerRouteId?: string;
    autoPrint?: boolean;
  }) => void;
}) {
  const defaultPrinterId = assignment?.defaultPrinterRouteId ?? null;
  const defaultPrinterName = defaultPrinterId
    ? (printerRouteMap.get(defaultPrinterId) ?? null)
    : null;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Location default */}
      <AssignmentRow
        label={locationName}
        icon={<LuMapPin />}
        isBold
        printerRouteId={defaultPrinterId}
        printerName={defaultPrinterName}
        inheritedName={null}
        autoPrint={assignment?.defaultAutoPrint ?? false}
        printerRouteOptions={printerRouteOptions}
        onPrinterChange={(printerRouteId) =>
          onUpdate({
            locationId,
            context: "default",
            printerRouteId,
            autoPrint: assignment?.defaultAutoPrint ?? false
          })
        }
        onAutoPrintChange={(autoPrint) =>
          onUpdate({
            locationId,
            context: "default",
            printerRouteId: defaultPrinterId ?? undefined,
            autoPrint
          })
        }
      />

      {/* Shipping */}
      <AssignmentRow
        label="Shipping"
        icon={<LuTruck />}
        isIndented
        printerRouteId={assignment?.shipping?.printerRouteId ?? null}
        printerName={
          assignment?.shipping?.printerRouteId
            ? (printerRouteMap.get(assignment.shipping.printerRouteId) ?? null)
            : null
        }
        inheritedName={defaultPrinterName}
        autoPrint={assignment?.shipping?.autoPrint ?? false}
        printerRouteOptions={printerRouteOptions}
        onPrinterChange={(printerRouteId) =>
          onUpdate({
            locationId,
            context: "shipping",
            printerRouteId,
            autoPrint: assignment?.shipping?.autoPrint ?? false
          })
        }
        onAutoPrintChange={(autoPrint) =>
          onUpdate({
            locationId,
            context: "shipping",
            printerRouteId: assignment?.shipping?.printerRouteId ?? undefined,
            autoPrint
          })
        }
      />

      {/* Receiving */}
      <AssignmentRow
        label="Receiving"
        icon={<LuHandCoins />}
        isIndented
        printerRouteId={assignment?.receiving?.printerRouteId ?? null}
        printerName={
          assignment?.receiving?.printerRouteId
            ? (printerRouteMap.get(assignment.receiving.printerRouteId) ?? null)
            : null
        }
        inheritedName={defaultPrinterName}
        autoPrint={assignment?.receiving?.autoPrint ?? false}
        printerRouteOptions={printerRouteOptions}
        onPrinterChange={(printerRouteId) =>
          onUpdate({
            locationId,
            context: "receiving",
            printerRouteId,
            autoPrint: assignment?.receiving?.autoPrint ?? false
          })
        }
        onAutoPrintChange={(autoPrint) =>
          onUpdate({
            locationId,
            context: "receiving",
            printerRouteId: assignment?.receiving?.printerRouteId ?? undefined,
            autoPrint
          })
        }
      />

      {/* Work Centers */}
      {workCenters.map((wc) => {
        const wcAssignment = assignment?.workCenters?.[wc.id];
        return (
          <AssignmentRow
            key={wc.id}
            label={wc.name}
            icon={<LuWrench />}
            isIndented
            printerRouteId={wcAssignment?.printerRouteId ?? null}
            printerName={
              wcAssignment?.printerRouteId
                ? (printerRouteMap.get(wcAssignment.printerRouteId) ?? null)
                : null
            }
            inheritedName={defaultPrinterName}
            autoPrint={wcAssignment?.autoPrint ?? false}
            printerRouteOptions={printerRouteOptions}
            onPrinterChange={(printerRouteId) =>
              onUpdate({
                locationId,
                context: "workCenter",
                contextId: wc.id,
                printerRouteId,
                autoPrint: wcAssignment?.autoPrint ?? false
              })
            }
            onAutoPrintChange={(autoPrint) =>
              onUpdate({
                locationId,
                context: "workCenter",
                contextId: wc.id,
                printerRouteId: wcAssignment?.printerRouteId ?? undefined,
                autoPrint
              })
            }
          />
        );
      })}
    </div>
  );
}

function AssignmentRow({
  label,
  icon,
  isBold,
  isIndented,
  printerRouteId,
  printerName,
  inheritedName,
  autoPrint,
  printerRouteOptions,
  onPrinterChange,
  onAutoPrintChange
}: {
  label: string;
  icon: ReactNode;
  isBold?: boolean;
  isIndented?: boolean;
  printerRouteId: string | null;
  printerName: string | null;
  inheritedName: string | null;
  autoPrint: boolean;
  printerRouteOptions: { value: string; label: string }[];
  onPrinterChange: (printerRouteId: string) => void;
  onAutoPrintChange: (autoPrint: boolean) => void;
}) {
  const displayState = printerRouteId
    ? ("assigned" as const)
    : inheritedName
      ? ("inherited" as const)
      : ("missing" as const);

  const placeholder =
    displayState === "inherited"
      ? `inherits ${inheritedName}`
      : displayState === "missing"
        ? "No printer"
        : undefined;

  return (
    <div
      className={`flex items-center justify-between py-2.5 ${isIndented ? "pl-7" : ""} ${!isBold ? "border-t border-border/50" : ""}`}
    >
      <div className="flex items-center gap-2">
        <div className="size-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
          <span className="size-4 text-muted-foreground">{icon}</span>
        </div>
        <span
          className={`text-sm ${isBold ? "font-medium" : "text-muted-foreground"}`}
        >
          {label}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Combobox
          size="sm"
          value={printerRouteId ?? ""}
          options={printerRouteOptions}
          onChange={(selected) => onPrinterChange(selected)}
          isClearable
          placeholder={placeholder}
        />

        <Switch
          variant="small"
          checked={autoPrint}
          onCheckedChange={onAutoPrintChange}
        />
      </div>
    </div>
  );
}
