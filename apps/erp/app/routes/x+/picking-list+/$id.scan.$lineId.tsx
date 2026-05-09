import type { Result } from "@carbon/auth";
import { success, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Combobox as ComboboxBase,
  cn,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast
} from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCircleCheck,
  LuList,
  LuQrCode,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useNavigate,
  useParams
} from "react-router";
import { useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem
} from "~/modules/inventory/inventory.service";
import { path } from "~/utils/path";

type TrackingType = "Serial" | "Batch" | null;

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id, lineId } = params;
  if (!id || !lineId) throw new Error("id and lineId are required");

  const payload = await request.json();
  const { trackedEntityId, pickedQuantity = 1 } = payload;

  if (!trackedEntityId) {
    return data({ success: false, message: "Tracked entity ID is required" });
  }

  const { error: fnError } = await client.functions.invoke("pick", {
    body: JSON.stringify({
      type: "pickTrackedEntityLine",
      pickingListId: id,
      pickingListLineId: lineId,
      trackedEntityId,
      pickedQuantity,
      companyId,
      userId
    })
  });

  if (fnError) {
    let message = "Failed to pick line";
    try {
      const body = await (fnError as any).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // best-effort
    }
    return data({ success: false, message });
  }

  throw redirect(
    path.to.pickingList(id),
    await flash(request, success("Entity scanned and picked"))
  );
}

export default function PickingListScanRoute() {
  const { id, lineId } = useParams();
  if (!id || !lineId) throw new Error("id and lineId are required");

  const routeData = useRouteData<{
    pickingList: PickingListDetail;
    pickingListLines: PickingListLine[];
  }>(path.to.pickingList(id));

  const line = routeData?.pickingListLines.find((l) => l.id === lineId);
  if (!line) throw new Error("Line not found");

  const { carbon } = useCarbon();
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<Result>();

  const trackingType: TrackingType = useMemo(() => {
    if (line.requiresSerialTracking) return "Serial";
    if (line.requiresBatchTracking) return "Batch";
    return null;
  }, [line.requiresBatchTracking, line.requiresSerialTracking]);

  const itemId = (line as any).itemId as string | undefined;
  const required = Number(line.adjustedQuantity ?? line.estimatedQuantity ?? 0);
  const picked = Number(line.pickedQuantity ?? 0);
  const need = Math.max(required - picked, 0);
  const initialQuantity = trackingType === "Serial" ? 1 : Math.max(need, 1);

  const onClose = () => navigate(path.to.pickingList(id));

  const todayLocal = useMemo(() => today(getLocalTimeZone()), []);
  const isExpiryPast = useCallback(
    (date: string | null | undefined) => {
      if (!date) return false;
      try {
        return parseDate(date).compare(todayLocal) < 0;
      } catch {
        return false;
      }
    },
    [todayLocal]
  );
  const formatExpiry = useCallback((date: string | null | undefined) => {
    if (!date) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      }).format(parseDate(date).toDate(getLocalTimeZone()));
    } catch {
      return date;
    }
  }, []);

  const { data: serialNumbers } = useSerialNumbers(
    trackingType === "Serial" ? itemId : undefined
  );
  const { data: batchNumbers } = useBatchNumbers(
    trackingType === "Batch" ? itemId : undefined
  );

  const serialOptions = useMemo(() => {
    return (
      serialNumbers?.data
        ?.filter((sn: any) => sn.status === "Available")
        .map((sn: any) => {
          const expired = isExpiryPast(sn.expirationDate);
          const labelText = sn.readableId ?? sn.id ?? "";
          const label = expired ? (
            <span key={sn.id} className="flex items-center gap-2">
              <span className="truncate">{labelText}</span>
              <Badge color="red">Expired</Badge>
            </span>
          ) : (
            labelText
          );
          const helperParts = [
            sn.expirationDate
              ? `${expired ? "Expired" : "Expires"} ${formatExpiry(sn.expirationDate)}`
              : null
          ].filter(Boolean) as string[];
          return {
            label,
            value: sn.id,
            helper: helperParts.length > 0 ? helperParts.join(" · ") : undefined
          };
        }) ?? []
    );
  }, [serialNumbers, isExpiryPast, formatExpiry]);

  const batchOptions = useMemo(() => {
    return (
      batchNumbers?.data
        ?.filter((bn: any) => bn.status === "Available")
        .map((bn: any) => {
          const expired = isExpiryPast(bn.expirationDate);
          const expiryNote = bn.expirationDate
            ? expired
              ? `EXPIRED ${formatExpiry(bn.expirationDate)}`
              : `Expires ${formatExpiry(bn.expirationDate)}`
            : null;
          const stockHelper = bn.readableId
            ? `${bn.id.slice(0, 10)} — ${bn.quantity} available · Batch ${bn.readableId}`
            : `${bn.id.slice(0, 10)} — ${bn.quantity} available`;
          return {
            label: bn.sourceDocumentReadableId ?? bn.readableId ?? bn.id,
            value: bn.id,
            helper: [expiryNote, stockHelper].filter(Boolean).join(" · "),
            availableQuantity: Number(bn.quantity ?? 0)
          };
        }) ?? []
    );
  }, [batchNumbers, isExpiryPast, formatExpiry]);

  const [activeTab, setActiveTab] = useState("scan");
  const [scanInput, setScanInput] = useState("");
  const [pickedQuantity, setPickedQuantity] = useState<number>(initialQuantity);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedEntity, setValidatedEntity] = useState<{
    id: string;
    quantity: number;
  } | null>(null);

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error((fetcher.data as any).message);
    }
  }, [fetcher.data]);

  const validateScanInput = async (input: string) => {
    if (!input.trim()) {
      setValidationError(null);
      setValidatedEntity(null);
      return;
    }
    setIsLoading(true);
    setValidationError(null);
    try {
      const { data: rows } = (await carbon
        ?.from("trackedEntity")
        .select("*")
        .or(`id.eq.${input},readableId.eq.${input}`)
        .limit(1)) ?? { data: null };
      const result = rows?.[0] ?? null;
      if (!result) {
        setValidationError(t`Tracked entity not found`);
        setValidatedEntity(null);
        return;
      }
      if (result.status !== "Available") {
        setValidationError(t`Entity is ${result.status}`);
        setValidatedEntity(null);
        return;
      }
      if (itemId && result.sourceDocumentId !== itemId) {
        setValidationError(
          t`Wrong item — expected ${(line as any).item?.readableId ?? itemId}`
        );
        setValidatedEntity(null);
        return;
      }
      const entityQuantity = Number(result.quantity ?? 0);
      setValidatedEntity({ id: result.id, quantity: entityQuantity });
      setPickedQuantity(
        trackingType === "Serial"
          ? 1
          : Math.min(Math.max(need, 1), entityQuantity || 1)
      );
    } catch {
      setValidationError(t`Error validating entity`);
      setValidatedEntity(null);
    } finally {
      setIsLoading(false);
    }
  };

  const onSelectEntity = (entityId: string) => {
    if (!entityId) {
      setValidatedEntity(null);
      setValidationError(null);
      return;
    }
    setValidationError(null);
    if (trackingType === "Serial") {
      setValidatedEntity({ id: entityId, quantity: 1 });
      setPickedQuantity(1);
    } else {
      const opt = batchOptions.find((o) => o.value === entityId);
      const available = opt?.availableQuantity ?? 0;
      setValidatedEntity({ id: entityId, quantity: available });
      setPickedQuantity(Math.min(Math.max(need, 1), available || 1));
    }
  };

  const submit = () => {
    if (!validatedEntity) {
      setValidationError(t`Scan or select an entity first`);
      return;
    }
    const qty = Number(pickedQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setValidationError(t`Picked quantity must be greater than 0`);
      return;
    }
    if (qty > validatedEntity.quantity) {
      setValidationError(t`Picked quantity cannot exceed entity quantity`);
      return;
    }
    fetcher.submit(
      { trackedEntityId: validatedEntity.id, pickedQuantity: qty },
      { method: "POST", encType: "application/json" }
    );
  };

  const isValid = validatedEntity !== null;
  const itemTitle =
    (line as any).item?.name ??
    (line as any).item?.readableId ??
    t`Pick tracked entity`;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{itemTitle}</ModalTitle>
          <ModalDescription>
            <Trans>
              Scan or select the{" "}
              {trackingType === "Serial" ? "serial" : "batch"} entity, then
              confirm the picked quantity.
            </Trans>
          </ModalDescription>
        </ModalHeader>

        <ModalBody>
          <div className="flex flex-col gap-4">
            {validationError && (
              <Alert variant="destructive">
                <LuTriangleAlert className="h-4 w-4" />
                <AlertTitle>{validationError}</AlertTitle>
              </Alert>
            )}

            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v);
                setValidatedEntity(null);
                setValidationError(null);
                setScanInput("");
              }}
            >
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="scan">
                  <LuQrCode className="mr-2" />
                  <Trans>Scan</Trans>
                </TabsTrigger>
                <TabsTrigger value="select">
                  <LuList className="mr-2" />
                  <Trans>Select</Trans>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="scan">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <InputGroup>
                      <Input
                        autoFocus
                        value={scanInput}
                        onChange={(e) => {
                          setScanInput(e.target.value);
                          setValidationError(null);
                          setValidatedEntity(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") validateScanInput(scanInput);
                        }}
                        onBlur={() => validateScanInput(scanInput)}
                        placeholder={t`Enter or scan entity ID`}
                        className={cn(
                          validationError && "border-destructive",
                          isValid &&
                            activeTab === "scan" &&
                            "border-emerald-500"
                        )}
                        disabled={isLoading || fetcher.state !== "idle"}
                      />
                      <InputRightElement className="pl-2">
                        {isLoading ? (
                          <div className="animate-spin h-4 w-4 border-2 border-muted border-t-foreground rounded-full" />
                        ) : validationError ? (
                          <LuX className="text-destructive" />
                        ) : isValid && activeTab === "scan" ? (
                          <LuCheck className="text-emerald-500" />
                        ) : (
                          <LuQrCode />
                        )}
                      </InputRightElement>
                    </InputGroup>
                  </div>
                  {trackingType === "Batch" && (
                    <QuantityField
                      value={pickedQuantity}
                      onChange={setPickedQuantity}
                      maxValue={validatedEntity?.quantity}
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="select">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ComboboxBase
                      placeholder={
                        trackingType === "Serial"
                          ? t`Select serial number`
                          : t`Select batch number`
                      }
                      value={validatedEntity?.id ?? ""}
                      onChange={onSelectEntity}
                      options={
                        trackingType === "Serial" ? serialOptions : batchOptions
                      }
                    />
                  </div>
                  {trackingType === "Batch" && (
                    <QuantityField
                      value={pickedQuantity}
                      onChange={setPickedQuantity}
                      maxValue={validatedEntity?.quantity}
                    />
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {isValid && (
              <Alert variant="default">
                <AlertTitle>
                  <Trans>Entity ready to pick</Trans>
                </AlertTitle>
                <AlertDescription>
                  <span className="font-mono text-xs">
                    {validatedEntity.id}
                  </span>
                  {" · "}
                  <Trans>
                    {String(pickedQuantity)} of{" "}
                    {String(validatedEntity.quantity)}{" "}
                    {line.unitOfMeasureCode ?? ""}
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            leftIcon={<LuCircleCheck />}
            isLoading={fetcher.state !== "idle"}
            isDisabled={!isValid || fetcher.state !== "idle"}
            onClick={submit}
          >
            <Trans>Pick</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function QuantityField({
  value,
  onChange,
  maxValue
}: {
  value: number;
  onChange: (n: number) => void;
  maxValue?: number;
}) {
  return (
    <div className="w-24">
      <NumberField
        value={value}
        onChange={onChange}
        minValue={0.01}
        maxValue={maxValue ?? 999999}
      >
        <NumberInputGroup className="relative">
          <NumberInput />
          <NumberInputStepper>
            <NumberIncrementStepper>
              <LuChevronUp size="1em" strokeWidth="3" />
            </NumberIncrementStepper>
            <NumberDecrementStepper>
              <LuChevronDown size="1em" strokeWidth="3" />
            </NumberDecrementStepper>
          </NumberInputStepper>
        </NumberInputGroup>
      </NumberField>
    </div>
  );
}

function useSerialNumbers(itemId?: string | null) {
  const fetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per itemId
  useEffect(() => {
    if (itemId) fetcher.load(path.to.api.serialNumbers(itemId, false));
  }, [itemId]);

  return { data: fetcher.data };
}

function useBatchNumbers(itemId?: string | null) {
  const fetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  useEffect(() => {
    if (itemId) fetcher.load(path.to.api.batchNumbers(itemId));
  }, [itemId, fetcher.load]);

  return { data: fetcher.data };
}
