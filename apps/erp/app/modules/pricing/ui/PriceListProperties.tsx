import {
  DatePicker,
  InputControlled,
  Select,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { useCallback, useEffect, useMemo } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Enumerable } from "~/components/Enumerable";
import { Currency, Customers, CustomerTypes } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { priceListPriceTypes } from "../pricing.models";
import type { PriceListDetail } from "../types";

function inlinePreview(
  value: string[],
  options: { value: string; label: string }[]
) {
  if (value.length === 0)
    return <span className="text-muted-foreground">Global</span>;
  const names = value
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .slice(0, 2);
  const overflow = value.length - names.length;
  return (
    <span className="truncate text-foreground">
      {names.join(", ")}
      {overflow > 0 && ` +${overflow}`}
    </span>
  );
}

type AssignmentRow = {
  id: string;
  customerId: string | null;
  customerTypeId: string | null;
};

const PriceListProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const permissions = usePermissions();

  const routeData = useRouteData<{
    priceList: PriceListDetail;
    assignments: AssignmentRow[];
  }>(path.to.priceList(id));

  const priceList = routeData?.priceList;
  const assignments = routeData?.assignments ?? [];

  const permissionModule = "sales";

  const canUpdate = permissions.can("update", permissionModule);
  // Active price lists are immutable for everything that affects pricing
  // (assignments, dates, currency, type). Name and description stay editable
  // because they're just labels. Forces users through "Create New Version"
  // before making pricing changes — satisfies AC-ERP-08.
  const isLocked = priceList?.status === "Active";
  const canEditPricing = canUpdate && !isLocked;

  const fetcher = useFetcher();
  const assignmentFetcher = useFetcher();

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (field: string, value: string | null) => {
      const formData = new FormData();
      formData.append("id", id);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.updatePriceList
      });
    },
    [id]
  );

  // Assignment data from current assignments
  const currentCustomerIds = useMemo(
    () =>
      assignments
        .filter((a) => a.customerId)
        .map((a) => a.customerId) as string[],
    [assignments]
  );

  const currentCustomerTypeIds = useMemo(
    () =>
      assignments
        .filter((a) => a.customerTypeId)
        .map((a) => a.customerTypeId) as string[],
    [assignments]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: assignmentFetcher.submit is stable
  const onSyncAssignments = useCallback(
    (overrides: { customerIds?: string[]; customerTypeIds?: string[] }) => {
      const formData = new FormData();
      formData.append("id", id);
      formData.append("field", "assignments");

      for (const cid of overrides.customerIds ?? currentCustomerIds) {
        formData.append("customerIds", cid);
      }
      for (const ctid of overrides.customerTypeIds ?? currentCustomerTypeIds) {
        formData.append("customerTypeIds", ctid);
      }

      assignmentFetcher.submit(formData, {
        method: "post",
        action: path.to.updatePriceList
      });
    },
    [id, currentCustomerIds, currentCustomerTypeIds]
  );

  const { locale } = useLocale();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium"
      }),
    [locale]
  );

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      {/* Header section */}
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            Properties
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin + path.to.priceList(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to price list</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(priceList?.name ?? "")}
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy price list name</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>

        <VStack spacing={1} className="pt-2">
          <ValidatedForm
            defaultValues={{ name: priceList?.name ?? undefined }}
            validator={z.object({ name: z.string().min(1) })}
            className="w-full -mt-2"
          >
            <span className="text-sm">
              <InputControlled
                label=""
                name="name"
                size="sm"
                inline
                isReadOnly={!canUpdate}
                value={priceList?.name ?? ""}
                onBlur={(e) => onUpdate("name", e.target.value ?? null)}
              />
            </span>
          </ValidatedForm>

          <ValidatedForm
            defaultValues={{
              description: priceList?.description ?? undefined
            }}
            validator={z.object({
              description: zfd.text(z.string().optional())
            })}
            className="w-full -mt-2"
          >
            <span className="text-xs text-muted-foreground">
              <InputControlled
                label=""
                name="description"
                size="sm"
                inline
                isReadOnly={!canUpdate}
                value={priceList?.description ?? ""}
                onBlur={(e) => onUpdate("description", e.target.value ?? null)}
              />
            </span>
          </ValidatedForm>
        </VStack>
      </VStack>

      <div className="border-b border-border" />

      <ValidatedForm
        defaultValues={{ priceType: priceList?.priceType ?? "" }}
        validator={z.object({ priceType: z.string().optional() })}
        className="w-full"
      >
        <Select
          options={priceListPriceTypes.map((t) => ({
            value: t,
            label: <Enumerable value={t} />
          }))}
          isReadOnly={!canEditPricing}
          label="Price Type"
          name="priceType"
          inline={(value) => <Enumerable value={value} />}
          onChange={(value) => {
            if (value) onUpdate("priceType", value.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ currencyCode: priceList?.currencyCode ?? undefined }}
        validator={z.object({
          currencyCode: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <Currency
          name="currencyCode"
          label="Currency"
          inline
          value={priceList?.currencyCode ?? ""}
          isReadOnly={!canEditPricing}
          onChange={(value) => {
            if (value?.value) onUpdate("currencyCode", value.value);
          }}
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      <ValidatedForm
        defaultValues={{ validFrom: priceList?.validFrom ?? "" }}
        validator={z.object({ validFrom: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <DatePicker
          name="validFrom"
          label="Valid From"
          inline
          isDisabled={!canEditPricing}
          onChange={(date) => onUpdate("validFrom", date)}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ validTo: priceList?.validTo ?? "" }}
        validator={z.object({ validTo: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <DatePicker
          name="validTo"
          label="Valid To"
          inline
          isDisabled={!canEditPricing}
          onChange={(date) => onUpdate("validTo", date)}
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      {/* Assignments */}
      <ValidatedForm
        defaultValues={{ customerIds: currentCustomerIds }}
        validator={z.object({
          customerIds: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Customers
          name="customerIds"
          label="Customers"
          value={currentCustomerIds}
          isReadOnly={!canEditPricing}
          inline={inlinePreview}
          onChange={(selected) => onSyncAssignments({ customerIds: selected })}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ customerTypeIds: currentCustomerTypeIds }}
        validator={z.object({
          customerTypeIds: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <CustomerTypes
          name="customerTypeIds"
          label="Customer Types"
          value={currentCustomerTypeIds}
          isReadOnly={!canEditPricing}
          inline={inlinePreview}
          onChange={(selected) =>
            onSyncAssignments({ customerTypeIds: selected })
          }
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      <VStack spacing={3}>
        <VStack spacing={1}>
          <p className="text-xs text-muted-foreground font-medium">Type</p>
          <span>{priceList?.type ?? "-"}</span>
        </VStack>

        <VStack spacing={1}>
          <p className="text-xs text-muted-foreground font-medium">Version</p>
          <span>Version {priceList?.version ?? 1}</span>
        </VStack>

        <VStack spacing={1}>
          <p className="text-xs text-muted-foreground font-medium">Created</p>
          <span className="text-muted-foreground">
            {priceList?.createdAt
              ? dateFormatter.format(new Date(priceList.createdAt))
              : "-"}
          </span>
        </VStack>
      </VStack>
    </VStack>
  );
};

export default PriceListProperties;
