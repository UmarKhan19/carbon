import { useCarbon } from "@carbon/auth";
import { Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SplitButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuCalendar,
  LuCircleAlert,
  LuEllipsisVertical,
  LuGroup,
  LuQrCode,
  LuSplit,
  LuTrash,
  LuX
} from "react-icons/lu";
import {
  Await,
  Outlet,
  useFetcher,
  useFetchers,
  useParams,
  useRevalidator,
  useSubmit
} from "react-router";
import { DocumentPreview, Empty, ItemThumbnail } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { Enumerable } from "~/components/Enumerable";
import FileDropzone from "~/components/FileDropzone";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData, useUser } from "~/hooks";
import { useItemRuleViolations } from "~/hooks/useItemRuleViolations";
import type {
  BatchProperty,
  ItemTracking,
  Receipt,
  ReceiptLine
} from "~/modules/inventory";
import { StorageUnitForm, splitValidator } from "~/modules/inventory";
import { getDocumentType } from "~/modules/shared/shared.service";
import type { action as receiptLinesUpdateAction } from "~/routes/x+/receipt+/lines.update";
import { useItems } from "~/stores";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import BatchPropertiesConfig from "../Batches/BatchPropertiesConfig";
import { BatchPropertiesFields } from "../Batches/BatchPropertiesFields";

const ReceiptLines = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const ruleViolations = useItemRuleViolations<typeof receiptLinesUpdateAction>(
    {
      action: path.to.bulkUpdateReceiptLine
    }
  );

  const { upload, deleteFile, getPath } = useReceiptFiles(receiptId);
  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    receiptFiles: PostgrestResponse<StorageItem>;
    receiptLineTracking: ItemTracking[];
    batchProperties: PostgrestResponse<BatchProperty>;
    itemShelfLife: PostgrestResponse<{
      itemId: string;
      mode: string;
      days: number | null;
    }>;
  }>(path.to.receipt(receiptId));

  const receiptsById = new Map<string, ReceiptLine>(
    // @ts-expect-error
    routeData?.receiptLines.map((line) => [line.id, line])
  );
  const pendingReceiptLines = usePendingReceiptLines();

  for (let pendingReceiptLine of pendingReceiptLines) {
    let item = receiptsById.get(pendingReceiptLine.id);
    let merged = item ? { ...item, ...pendingReceiptLine } : pendingReceiptLine;
    receiptsById.set(pendingReceiptLine.id, merged as ReceiptLine);
  }

  const receiptLines = Array.from(receiptsById.values());

  const [serialNumbersByLineId, setSerialNumbersByLineId] = useState<
    Record<string, { index: number; number: string }[]>
  >(() => {
    return receiptLines.reduce((acc, line) => {
      if (!line.requiresSerialTracking) return acc;

      const trackedEntitiesForLine = routeData?.receiptLineTracking.filter(
        (t) => {
          const attributes = t.attributes as TrackedEntityAttributes;
          return attributes["Receipt Line"] === line.id;
        }
      );

      if (!trackedEntitiesForLine) return acc;
      return {
        ...acc,
        [line.id!]: Array.from(
          { length: line.receivedQuantity ?? 0 },
          (_, index) => {
            const serialNumberEntity = trackedEntitiesForLine.find((t) => {
              const attributes = t.attributes as TrackedEntityAttributes;
              return attributes["Receipt Line Index"] === index;
            });

            const serialNumber = serialNumberEntity?.readableId || "";

            return {
              index,
              number: serialNumber
            };
          }
        )
      };
    }, {});
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    setSerialNumbersByLineId(
      receiptLines.reduce((acc, line) => {
        if (!line.requiresSerialTracking) return acc;

        const trackedEntitiesForLine = routeData?.receiptLineTracking.filter(
          (t) => {
            const attributes = t.attributes as TrackedEntityAttributes;
            return attributes["Receipt Line"] === line.id;
          }
        );

        if (!trackedEntitiesForLine) return acc;
        return {
          ...acc,
          [line.id!]: Array.from(
            { length: line.receivedQuantity ?? 0 },
            (_, index) => {
              const serialNumberEntity = trackedEntitiesForLine.find((t) => {
                const attributes = t.attributes as TrackedEntityAttributes;
                return attributes["Receipt Line Index"] === index;
              });

              const serialNumber = serialNumberEntity?.readableId || "";

              return {
                index,
                number: serialNumber
              };
            }
          )
        };
      }, {})
    );
  }, [routeData?.receipt?.sourceDocumentId, routeData?.receiptLines?.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateReceiptLine = useCallback(
    async ({
      lineId,
      field,
      value
    }:
      | {
          lineId: string;
          field: "receivedQuantity";
          value: number;
        }
      | {
          lineId: string;
          field: "storageUnitId";
          value: string;
        }) => {
      const formData = new FormData();

      formData.append("ids", lineId);
      formData.append("field", field);
      formData.append("value", value.toString());
      ruleViolations.submit(formData);
    },

    []
  );

  const isPosted =
    routeData?.receipt.status === "Posted" ||
    routeData?.receipt.status === "Voided";

  return (
    <>
      <ruleViolations.ViolationModal />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Receipt Lines</Trans>
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="border rounded-lg">
            {receiptLines.length === 0 ? (
              <Empty className="py-6" />
            ) : (
              receiptLines.map((line, index) => {
                const trackingCandidates =
                  routeData?.receiptLineTracking?.filter((t) => {
                    const attributes = t.attributes as TrackedEntityAttributes;
                    return attributes["Receipt Line"] === line.id;
                  }) ?? [];
                const tracking =
                  trackingCandidates.find((t) => t.expirationDate) ??
                  trackingCandidates[0];
                return (
                  <ReceiptLineItem
                    key={line.id}
                    line={line}
                    receipt={routeData?.receipt}
                    isReadOnly={isPosted}
                    onUpdate={onUpdateReceiptLine}
                    files={routeData?.receiptFiles}
                    className={
                      index === receiptLines.length - 1 ? "border-none" : ""
                    }
                    serialNumbers={serialNumbersByLineId[line.id!] || []}
                    getPath={(file) => getPath(file, line.id!)}
                    onSerialNumbersChange={(newSerialNumbers) => {
                      setSerialNumbersByLineId((prev) => ({
                        ...prev,
                        [line.id!]: newSerialNumbers
                      }));
                    }}
                    batchProperties={routeData?.batchProperties}
                    itemShelfLife={routeData?.itemShelfLife}
                    tracking={tracking}
                    upload={(files) => upload(files, line.id!)}
                    deleteFile={(file) => deleteFile(file, line.id!)}
                  />
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

function ReceiptLineItem({
  line,
  receipt,
  className,
  isReadOnly,
  onUpdate,
  files,
  batchProperties,
  itemShelfLife,
  tracking,
  serialNumbers,
  getPath,
  onSerialNumbersChange,
  upload,
  deleteFile
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  className?: string;
  isReadOnly: boolean;
  files?: PostgrestResponse<StorageItem>;
  batchProperties?: PostgrestResponse<BatchProperty>;
  itemShelfLife?: PostgrestResponse<{
    itemId: string;
    mode: string;
    days: number | null;
  }>;
  tracking: ItemTracking | undefined;
  serialNumbers: { index: number; number: string }[];
  getPath: (file: StorageItem) => string;
  onSerialNumbersChange: (
    serialNumbers: { index: number; number: string }[]
  ) => void;
  onUpdate: ({
    lineId,
    field,
    value
  }:
    | {
        lineId: string;
        field: "receivedQuantity";
        value: number;
      }
    | {
        lineId: string;
        field: "storageUnitId";
        value: string;
      }) => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  deleteFile: (file: StorageItem) => Promise<void>;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const item = items.find((p) => p.id === line.itemId);
  const unitsOfMeasure = useUnitOfMeasure();
  const splitDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  return (
    <div className={cn("flex flex-col border-b p-6 gap-6 relative", className)}>
      <div className="absolute top-4 right-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Line options`}
              variant="secondary"
              icon={<LuEllipsisVertical />}
              size="sm"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={isReadOnly}
              onClick={splitDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuSplit />} />
              {t`Split receipt line`}
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              disabled={isReadOnly}
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              {t`Delete receipt line`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <ItemThumbnail
              size="md"
              thumbnailPath={line.thumbnailPath}
              type={(item?.type as "Part") ?? "Part"}
            />
            <VStack spacing={0}>
              <span className="text-sm font-medium">{item?.name}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {item?.readableIdWithRevision}
              </span>
              <div className="mt-2">
                <Enumerable
                  value={
                    unitsOfMeasure?.find((u) => u.value === line.unitOfMeasure)
                      ?.label ?? null
                  }
                />
              </div>
            </VStack>
            <VStack spacing={1}>
              <label className="text-xs text-muted-foreground">Received</label>

              <NumberField
                value={line.receivedQuantity ?? 0}
                onChange={(value) => {
                  // Default to 0 if value is NaN, null, or undefined
                  const safeValue = isNaN(value) || value == null ? 0 : value;
                  onUpdate({
                    lineId: line.id!,
                    field: "receivedQuantity",
                    value: safeValue
                  });
                  // Adjust serial numbers array size while preserving existing values
                  if (safeValue > serialNumbers.length) {
                    onSerialNumbersChange([
                      ...serialNumbers,
                      ...Array.from(
                        { length: safeValue - serialNumbers.length },
                        () => ({
                          index: serialNumbers.length,
                          number: ""
                        })
                      )
                    ]);
                  } else if (safeValue < serialNumbers.length) {
                    onSerialNumbersChange(serialNumbers.slice(0, safeValue));
                  }
                }}
              >
                <NumberInput
                  className="disabled:bg-transparent disabled:opacity-100 min-w-[100px]"
                  isDisabled={isReadOnly}
                  size="sm"
                  min={0}
                />
              </NumberField>
            </VStack>
          </HStack>
        </HStack>
        <div className="flex flex-grow items-center justify-between gap-2 pl-4">
          <HStack spacing={4}>
            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">Ordered</label>
              <span className="text-sm py-1.5">{line.orderQuantity ?? 0}</span>
            </VStack>

            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">
                Outstanding
              </label>
              <HStack className="justify-center">
                <span className="text-sm py-1.5">
                  {(line.outstandingQuantity ?? 0) -
                    (line.receivedQuantity ?? 0)}
                </span>

                {(line.receivedQuantity ?? 0) >
                  (line.outstandingQuantity ?? 0) && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuCircleAlert className="text-red-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      There are more received than ordered
                    </TooltipContent>
                  </Tooltip>
                )}
              </HStack>
            </VStack>
          </HStack>

          <StorageUnit
            locationId={line.locationId}
            storageUnitId={line.storageUnitId}
            isReadOnly={isReadOnly}
            onChange={(storageUnit) => {
              onUpdate({
                lineId: line.id!,
                field: "storageUnitId",
                value: storageUnit
              });
            }}
          />
        </div>
      </div>
      {line.requiresBatchTracking && (
        <>
          <BatchForm
            receipt={receipt}
            line={line}
            isReadOnly={isReadOnly}
            tracking={tracking}
            batchProperties={batchProperties}
            itemShelfLife={itemShelfLife}
          />
        </>
      )}
      {line.requiresSerialTracking && (
        <SerialForm
          receipt={receipt}
          line={line}
          serialNumbers={serialNumbers}
          isReadOnly={isReadOnly}
          onSerialNumbersChange={onSerialNumbersChange}
          itemShelfLife={itemShelfLife}
          tracking={tracking}
        />
      )}
      {(line.requiresBatchTracking || line.requiresSerialTracking) && (
        <>
          <Suspense fallback={null}>
            <Await resolve={files}>
              {(resolvedFiles) => {
                const lineFiles = resolvedFiles?.data?.filter(
                  (file) => file.bucket === line.id
                );
                return Array.isArray(lineFiles) && lineFiles.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {lineFiles.map((file) => {
                      const documentType = getDocumentType(file.name);
                      const isPreviewable = ["PDF", "Image"].includes(
                        documentType
                      );

                      return (
                        <HStack key={file.id}>
                          <DocumentIcon type={documentType} />
                          <span className="font-medium text-sm">
                            {isPreviewable ? (
                              <DocumentPreview
                                bucket="private"
                                pathToFile={getPath(file)}
                                // @ts-expect-error
                                type={getDocumentType(file.name)}
                              >
                                {file.name}
                              </DocumentPreview>
                            ) : (
                              file.name
                            )}
                          </span>
                          <IconButton
                            icon={<LuX />}
                            aria-label={t`Delete file`}
                            variant="ghost"
                            onClick={() => deleteFile(file)}
                          />
                        </HStack>
                      );
                    })}
                  </div>
                ) : null;
              }}
            </Await>
          </Suspense>
          <FileDropzone onDrop={upload} />
          {splitDisclosure.isOpen && (
            <SplitReceiptLineModal
              line={line}
              onClose={splitDisclosure.onClose}
            />
          )}
          {deleteDisclosure.isOpen && (
            <ConfirmDelete
              name="Receipt Line"
              text="Are you sure you want to delete this receipt line?"
              action={path.to.receiptLineDelete(line.id!)}
              onCancel={deleteDisclosure.onClose}
              onSubmit={deleteDisclosure.onClose}
            />
          )}
        </>
      )}
    </div>
  );
}

function BatchForm({
  line,
  receipt,
  batchProperties,
  itemShelfLife,
  tracking,
  isReadOnly
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  isReadOnly: boolean;
  batchProperties?: PostgrestResponse<BatchProperty>;
  itemShelfLife?: PostgrestResponse<{
    itemId: string;
    mode: string;
    days: number | null;
  }>;
  tracking: ItemTracking | undefined;
}) {
  const { t } = useLingui();
  const submit = useSubmit();
  const shelfLife = itemShelfLife?.data?.find(
    (sl) => sl.itemId === line.itemId
  );
  const showExpiryField = shelfLife?.mode === "Set on Receipt";
  const [values, setValues] = useState<{
    number: string;
    properties: any;
    expirationDate: string;
  }>(() => {
    if (tracking) {
      const attributes = tracking.attributes as TrackedEntityAttributes;
      return {
        number: tracking.readableId || "",
        expirationDate: tracking.expirationDate ?? "",
        properties: Object.entries(attributes)
          .filter(
            ([key]) =>
              ![
                "Shipment Line",
                "Shipment",
                "Shipment Line Index",
                "Receipt Line",
                "Receipt",
                "expirationDate"
              ].includes(key)
          )
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {})
      };
    }
    return {
      number: "",
      properties: {},
      expirationDate: ""
    };
  });

  useEffect(() => {
    if (!tracking) return;
    setValues((prev) => {
      const attributes = tracking.attributes as TrackedEntityAttributes;
      const newExpiration = tracking.expirationDate ?? "";
      const newNumber = tracking.readableId || "";
      if (prev.expirationDate === newExpiration && prev.number === newNumber)
        return prev;
      return {
        number: newNumber || prev.number,
        expirationDate: newExpiration || prev.expirationDate,
        properties: Object.entries(attributes)
          .filter(
            ([key]) =>
              ![
                "Shipment Line",
                "Shipment",
                "Shipment Line Index",
                "Receipt Line",
                "Receipt",
                "expirationDate"
              ].includes(key)
          )
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {})
      };
    });
  }, [tracking]);

  const updateBatchNumber = async (newValues: typeof values, isNew = false) => {
    if (!receipt?.id || !newValues.number.trim()) return;

    let batchMatch = null;
    if (isNew && tracking) {
      batchMatch = tracking.readableId;
    }

    let valuesToSubmit = newValues;

    if (batchMatch) {
      const attributes = tracking?.attributes as TrackedEntityAttributes;
      valuesToSubmit = {
        ...newValues,
        properties: Object.entries(attributes)
          .filter(([key]) => !["Receipt Line"].includes(key))
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {})
      };

      // Just update the local state without triggering another database write
      setValues(valuesToSubmit);
    }

    const formData = new FormData();
    formData.append("itemId", line.itemId!);
    formData.append("receiptId", receipt.id);
    formData.append("receiptLineId", line.id!);
    formData.append("trackingType", "batch");
    if (tracking?.id) {
      formData.append("trackedEntityId", tracking.id);
    }
    formData.append("batchNumber", valuesToSubmit.number.trim());
    const propertiesWithExpiry = valuesToSubmit.expirationDate
      ? {
          ...valuesToSubmit.properties,
          expirationDate: valuesToSubmit.expirationDate
        }
      : valuesToSubmit.properties;
    formData.append("properties", JSON.stringify(propertiesWithExpiry));
    formData.append("quantity", (line.receivedQuantity ?? 0).toString());

    submit(formData, {
      method: "post",
      action: path.to.receiptLinesTracking(receipt.id),
      navigate: false
    });
  };

  const handlePropertiesChange = (newProperties: any) => {
    const newValues = {
      ...values,
      properties: newProperties
    };
    setValues(newValues);
    updateBatchNumber(newValues);
  };

  const navigateToLineTrackingLabels = (zpl?: boolean, labelSize?: string) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.receiptLabelsZpl(receipt?.id ?? "", {
            lineId: line.id!,
            labelSize
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.receiptLabelsPdf(receipt?.id ?? "", {
            lineId: line.id!,
            labelSize
          }),
        "_blank"
      );
    }
  };
  const propertiesDisclosure = useDisclosure();

  return (
    <div className="flex flex-col gap-6 w-full p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">Batch Properties</Heading>
        <div className="flex items-center gap-2">
          <SplitButton
            size="sm"
            leftIcon={<LuQrCode />}
            dropdownItems={labelSizes.map((size) => ({
              label: size.name,
              onClick: () => navigateToLineTrackingLabels(!!size.zpl, size.id)
            }))}
            onClick={() => navigateToLineTrackingLabels(false)}
            variant="secondary"
          >
            Tracking Labels
          </SplitButton>
          <Button
            variant="secondary"
            leftIcon={<LuGroup />}
            size="sm"
            onClick={propertiesDisclosure.onOpen}
          >
            Edit Properties
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 ">
        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuGroup /> <Trans>Batch Number</Trans>
            {showExpiryField && (
              <span className="text-destructive-foreground">*</span>
            )}
          </label>

          <Input
            placeholder={`Batch number`}
            isDisabled={isReadOnly}
            value={values.number}
            onChange={(e) => {
              setValues((prev) => ({
                ...prev,
                number: e.target.value
              }));
            }}
            onBlur={() => {
              updateBatchNumber(values, true);
            }}
          />
        </div>

        {showExpiryField && (
          <div className="flex flex-col gap-2 w-full">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <LuCalendar /> <Trans>Expiration Date</Trans>
            </label>
            <DatePicker
              isDisabled={isReadOnly}
              value={
                values.expirationDate ? parseDate(values.expirationDate) : null
              }
              onChange={(date) => {
                const next = date?.toString() ?? "";
                const newValues = { ...values, expirationDate: next };
                setValues(newValues);
                if (newValues.number.trim()) {
                  updateBatchNumber(newValues, true);
                } else if (next) {
                  toast.error(
                    t`Enter a batch number before setting the expiration date`
                  );
                }
              }}
            />
          </div>
        )}

        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedBatchProperties) => {
              return (
                <BatchPropertiesFields
                  itemId={line.itemId!}
                  properties={
                    resolvedBatchProperties?.data?.filter(
                      (p) => p.itemId === line.itemId
                    ) ?? []
                  }
                  isReadOnly={isReadOnly}
                  values={values.properties}
                  onChange={(newProperties) => {
                    handlePropertiesChange(newProperties);
                  }}
                />
              );
            }}
          </Await>
        </Suspense>
      </div>
      {propertiesDisclosure.isOpen && (
        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedBatchProperties) => {
              return (
                <BatchPropertiesConfig
                  itemId={line.itemId!}
                  properties={resolvedBatchProperties?.data ?? []}
                  type="modal"
                  onClose={propertiesDisclosure.onClose}
                />
              );
            }}
          </Await>
        </Suspense>
      )}
    </div>
  );
}

function SerialForm({
  line,
  receipt,
  batchProperties,
  itemShelfLife,
  serialNumbers,
  isReadOnly,
  onSerialNumbersChange,
  tracking
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  batchProperties?: PostgrestResponse<BatchProperty>;
  itemShelfLife?: PostgrestResponse<{
    itemId: string;
    mode: string;
    days: number | null;
  }>;
  serialNumbers: { index: number; number: string }[];
  isReadOnly: boolean;
  onSerialNumbersChange: (
    serialNumbers: { index: number; number: string }[]
  ) => void;
  tracking: ItemTracking | undefined;
}) {
  const shelfLife = itemShelfLife?.data?.find(
    (sl) => sl.itemId === line.itemId
  );
  const showExpiryField = shelfLife?.mode === "Set on Receipt";
  const [expiryDate, setExpiryDate] = useState(tracking?.expirationDate ?? "");

  useEffect(() => {
    if (tracking?.expirationDate) {
      setExpiryDate((prev) => prev || tracking.expirationDate || "");
    }
  }, [tracking?.expirationDate]);

  const [errors, setErrors] = useState<Record<number, string>>({});

  // Check for duplicates within the current form
  const validateSerialNumber = useCallback(
    (serialNumber: string, currentIndex: number) => {
      const trimmedNumber = serialNumber.trim();
      if (!trimmedNumber) return null;

      const isDuplicate = serialNumbers.some(
        (sn, idx) => idx !== currentIndex && sn.number.trim() === trimmedNumber
      );

      return isDuplicate ? "Duplicate serial number" : null;
    },
    [serialNumbers]
  );

  const updateSerialNumber = useCallback(
    async (serialNumber: { index: number; number: string }) => {
      if (!receipt?.id || !serialNumber.number.trim()) return;

      const error = validateSerialNumber(
        serialNumber.number,
        serialNumber.index
      );
      if (error) {
        setErrors((prev) => ({ ...prev, [serialNumber.index]: error }));
        return;
      }

      const formData = new FormData();
      formData.append("itemId", line.itemId!);
      formData.append("receiptId", receipt.id);
      formData.append("receiptLineId", line.id!);
      formData.append("trackingType", "serial");
      formData.append("index", serialNumber.index.toString());
      formData.append("serialNumber", serialNumber.number.trim());
      if (expiryDate) {
        formData.append("expiryDate", expiryDate);
      }

      try {
        const response = await fetch(path.to.receiptLinesTracking(receipt.id), {
          method: "POST",
          body: formData
        });

        if (response.ok) {
          // Clear error if submission was successful
          setErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors[serialNumber.index];
            return newErrors;
          });
        } else {
          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: "Serial number already exists"
          }));
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("duplicate")) {
          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: "Serial number already exists for this item"
          }));
        }
      }
    },
    [line.id, line.itemId, receipt?.id, validateSerialNumber, expiryDate]
  );

  const navigateToLineTrackingLabels = (zpl?: boolean, labelSize?: string) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.receiptLabelsZpl(receipt?.id ?? "", {
            lineId: line.id!,
            labelSize
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.receiptLabelsPdf(receipt?.id ?? "", {
            lineId: line.id!,
            labelSize
          }),
        "_blank"
      );
    }
  };
  const propertiesDisclosure = useDisclosure();
  console.log({ serialNumbers, expiryDate });
  return (
    <div className="flex flex-col gap-6 p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-6">
        <Heading size="h4">Serial Numbers</Heading>
        <div className="flex items-center gap-2">
          <SplitButton
            size="sm"
            leftIcon={<LuQrCode />}
            dropdownItems={labelSizes.map((size) => ({
              label: size.name,
              onClick: () => navigateToLineTrackingLabels(!!size.zpl, size.id)
            }))}
            onClick={() => navigateToLineTrackingLabels(false)}
            variant="secondary"
          >
            Tracking Labels
          </SplitButton>
        </div>
      </div>

      {showExpiryField && (
        <div className="flex flex-col gap-2 max-w-xs">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuCalendar />{" "}
            <Trans>Expiration Date (applies to all serials on this line)</Trans>
          </label>
          <DatePicker
            isDisabled={isReadOnly}
            value={expiryDate ? parseDate(expiryDate) : null}
            onChange={(date) => setExpiryDate(date?.toString() ?? "")}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-3">
        {serialNumbers.map((serialNumber, index) => (
          <div
            key={`${line.id}-${index}-serial`}
            className="flex flex-col gap-1"
          >
            <Input
              placeholder={`Serial ${index + 1}`}
              isDisabled={isReadOnly}
              value={serialNumber.number}
              onChange={(e) => {
                const newValue = e.target.value;
                const error = validateSerialNumber(newValue, index);

                setErrors((prev) => {
                  const newErrors = { ...prev };
                  if (error) {
                    newErrors[index] = error;
                  } else {
                    delete newErrors[index];
                  }
                  return newErrors;
                });

                const newSerialNumbers = [...serialNumbers];
                newSerialNumbers[index] = {
                  index,
                  number: newValue
                };
                onSerialNumbersChange(newSerialNumbers);
              }}
              onBlur={() => {
                if (serialNumber.number.trim()) {
                  updateSerialNumber(serialNumber);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (serialNumber.number.trim()) {
                    updateSerialNumber(serialNumber);
                  }
                  const nextInput = e.currentTarget
                    .closest("div")
                    ?.querySelector(`input[placeholder="Serial ${index + 2}"]`);
                  if (nextInput) {
                    (nextInput as HTMLElement).focus();
                  }
                }
              }}
              className={cn(errors[index] && "border-destructive")}
            />
            {errors[index] && (
              <span className="text-xs text-destructive">{errors[index]}</span>
            )}
          </div>
        ))}
        {propertiesDisclosure.isOpen && (
          <Suspense fallback={null}>
            <Await resolve={batchProperties}>
              {(resolvedBatchProperties) => {
                return (
                  <BatchPropertiesConfig
                    itemId={line.itemId!}
                    properties={resolvedBatchProperties?.data ?? []}
                    type="modal"
                    onClose={propertiesDisclosure.onClose}
                  />
                );
              }}
            </Await>
          </Suspense>
        )}
      </div>
    </div>
  );
}

function SplitReceiptLineModal({
  line,
  onClose
}: {
  line: ReceiptLine;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.receiptLineSplit}
          validator={splitValidator}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Split Receipt Line</ModalTitle>
            <ModalDescription>
              Select the quantity that you'd like to split into a new line.
            </ModalDescription>
          </ModalHeader>

          <ModalBody>
            <input
              type="hidden"
              name="documentId"
              value={line.receiptId ?? ""}
            />
            <input type="hidden" name="documentLineId" value={line.id!} />
            <input
              type="hidden"
              name="locationId"
              value={line.locationId ?? ""}
            />
            <Number
              name="quantity"
              label={t`Quantity`}
              maxValue={line.orderQuantity ?? 0 - 0.0001}
              minValue={0.0001}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit>Split Line</Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

type StorageUnitTreeRow = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  ancestorPath: string[];
};

// Receipt-local: pulls from storageUnits_recursive so the dropdown can
// indent each row by depth and group children under their parent. The
// shared useStorageUnits hook stays flat to avoid disturbing the many
// other call sites; only Receipt benefits from the tree view today.
function useStorageUnitsTree(locationId?: string | null) {
  const fetcher = useFetcher<{
    data: StorageUnitTreeRow[] | null;
    error: unknown;
  }>();

  useEffect(() => {
    if (locationId) {
      fetcher.load(path.to.api.storageUnitsTree(locationId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  return fetcher.data?.data ?? [];
}

// Drill-down picker. Picking a parent doesn't select it as the value — it
// pushes onto the breadcrumb stack and reveals that node's children. Click
// the row body to select; click the chevron to drill in. Breadcrumb chips
// at the top let the user pop back up. Search flattens the view: every
// matching node is shown with its full path until the box is cleared.
function StorageUnit({
  locationId,
  storageUnitId,
  isReadOnly,
  onChange
}: {
  locationId: string | null;
  storageUnitId: string | null;
  isReadOnly: boolean;
  onChange: (storageUnit: string) => void;
}) {
  const rows = useStorageUnitsTree(locationId);
  const newStorageUnitModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => {
    const m = new Map<string, StorageUnitTreeRow>();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  }, [rows]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, StorageUnitTreeRow[]>();
    rows.forEach((r) => {
      const arr = m.get(r.parentId) ?? [];
      arr.push(r);
      m.set(r.parentId, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [rows]);

  const currentParentId = stack.length === 0 ? null : stack[stack.length - 1];
  const currentChildren = childrenOf.get(currentParentId) ?? [];
  const breadcrumb = stack
    .map((id) => byId.get(id))
    .filter((r): r is StorageUnitTreeRow => Boolean(r));

  const renderPath = useCallback(
    (row: StorageUnitTreeRow) =>
      (row.ancestorPath ?? [])
        .slice(0, -1)
        .map((id) => byId.get(id)?.name)
        .filter(Boolean)
        .join(" / "),
    [byId]
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return rows.filter((r) => {
      if (r.name?.toLowerCase().includes(q)) return true;
      return (r.ancestorPath ?? []).some((id) =>
        byId.get(id)?.name?.toLowerCase().includes(q)
      );
    });
  }, [search, rows, byId]);

  if (!locationId) return null;

  const selectedRow = storageUnitId ? byId.get(storageUnitId) : undefined;
  const triggerLabel = selectedRow?.name ?? "";

  const reset = () => {
    setStack([]);
    setSearch("");
  };

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    reset();
  };

  return (
    <div className="flex flex-col items-start gap-1 min-w-[140px] text-sm">
      <label className="text-xs text-muted-foreground">Storage Unit</label>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            disabled={isReadOnly}
            className={cn(
              "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-left",
              "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isReadOnly && "opacity-60 cursor-not-allowed",
              !triggerLabel && "text-muted-foreground"
            )}
          >
            <span className="truncate">{triggerLabel || "Select"}</span>
            {storageUnitId && !isReadOnly ? (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                className="flex h-4 w-4 items-center justify-center rounded hover:bg-muted"
              >
                <LuX className="h-3 w-3" />
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <button
              type="button"
              onClick={() => setStack([])}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                stack.length === 0
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              All
            </button>
            {breadcrumb.map((row, i) => (
              <span key={row.id} className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs">/</span>
                <button
                  type="button"
                  onClick={() => setStack(stack.slice(0, i + 1))}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                    i === breadcrumb.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {row.name}
                </button>
              </span>
            ))}
          </div>
          <div className="border-b px-2 py-1.5">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-7 text-sm"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {searchResults ? (
              searchResults.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No matches
                </div>
              ) : (
                searchResults.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => select(row.id)}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span>{row.name}</span>
                    {renderPath(row) && (
                      <span className="text-xs text-muted-foreground">
                        {renderPath(row)}
                      </span>
                    )}
                  </button>
                ))
              )
            ) : currentChildren.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No storage units
              </div>
            ) : (
              currentChildren.map((row) => {
                const hasChildren = (childrenOf.get(row.id) ?? []).length > 0;
                return (
                  <div
                    key={row.id}
                    className="flex items-stretch hover:bg-muted"
                  >
                    <button
                      type="button"
                      onClick={() => select(row.id)}
                      className="flex-1 px-3 py-1.5 text-left text-sm"
                    >
                      {row.name}
                    </button>
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => {
                          setStack([...stack, row.id]);
                          setSearch("");
                        }}
                        className="flex w-7 items-center justify-center border-l text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${row.name}`}
                      >
                        ›
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t px-2 py-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
                newStorageUnitModal.onOpen();
                setCreated(search);
              }}
              className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              + New storage unit{search ? `: "${search}"` : ""}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {newStorageUnitModal.isOpen && (
        <StorageUnitForm
          locationId={locationId}
          type="modal"
          onClose={() => {
            setCreated("");
            newStorageUnitModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            locationId: locationId,
            storageTypeIds: []
          }}
        />
      )}
    </div>
  );
}

const usePendingReceiptLines = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.bulkUpdateReceiptLine;
    })
    .reduce<{ id: string; [key: string]: string | null }[]>((acc, fetcher) => {
      const lineId = fetcher.formData.get("ids") as string;
      const field = fetcher.formData.get("field") as string;
      const value = fetcher.formData.get("value") as string;

      if (lineId && field && value) {
        const newItem: { id: string; [key: string]: string | null } = {
          id: lineId,
          [field]: value
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};

export default ReceiptLines;

function useReceiptFiles(receiptId: string) {
  const { t } = useLingui();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const getPath = useCallback(
    ({ name }: { name: string }, lineId: string) => {
      return `${company.id}/inventory/${lineId}/${stripSpecialCharacters(
        name
      )}`;
    },
    [company.id]
  );

  const submit = useSubmit();
  const revalidator = useRevalidator();
  const upload = useCallback(
    async (files: File[], lineId: string) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      for (const file of files) {
        const fileName = getPath({ name: file.name }, lineId);
        toast.info(`Uploading ${file.name}`);
        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (fileUpload.error) {
          toast.error(`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          toast.success(`Uploaded: ${file.name}`);
          const formData = new FormData();
          formData.append("path", fileUpload.data.path);
          formData.append("name", file.name);
          formData.append("size", Math.round(file.size / 1024).toString());
          formData.append("sourceDocument", "Receipt");
          formData.append("sourceDocumentId", receiptId);

          submit(formData, {
            method: "post",
            action: path.to.newDocument,
            navigate: false,
            fetcherKey: `${lineId}:${file.name}`
          });
        }
      }
      revalidator.revalidate();
    },
    [carbon, revalidator, getPath, receiptId, submit, t]
  );

  const deleteFile = useCallback(
    async (file: StorageItem, lineId: string) => {
      const fileDelete = await carbon?.storage
        .from("private")
        .remove([getPath(file, lineId)]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [getPath, carbon?.storage, revalidator]
  );

  return { upload, deleteFile, getPath };
}
