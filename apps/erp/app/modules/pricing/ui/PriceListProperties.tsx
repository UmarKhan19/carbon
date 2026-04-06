import {
  CreatableMultiSelect,
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
import { Currency } from "~/components/Form";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { useSupplierTypes } from "~/components/Form/SupplierType";
import { usePermissions, useRouteData } from "~/hooks";
import { useCustomers } from "~/stores/customers";
import { useSuppliers } from "~/stores/suppliers";
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
  supplierId: string | null;
  supplierTypeId: string | null;
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

  const permissionModule =
    priceList?.type === "Purchase" ? "purchasing" : "sales";
  const isSales = priceList?.type === "Sales";

  const canUpdate = permissions.can("update", permissionModule);

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

  const currentSupplierIds = useMemo(
    () =>
      assignments
        .filter((a) => a.supplierId)
        .map((a) => a.supplierId) as string[],
    [assignments]
  );

  const currentSupplierTypeIds = useMemo(
    () =>
      assignments
        .filter((a) => a.supplierTypeId)
        .map((a) => a.supplierTypeId) as string[],
    [assignments]
  );

  // Options from stores/hooks
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  const customerTypeOptions = useCustomerTypes();
  const supplierTypeOptions = useSupplierTypes();

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name })),
    [customers]
  );

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: assignmentFetcher.submit is stable
  const onSyncAssignments = useCallback(
    (overrides: {
      customerIds?: string[];
      customerTypeIds?: string[];
      supplierIds?: string[];
      supplierTypeIds?: string[];
    }) => {
      const formData = new FormData();
      formData.append("id", id);
      formData.append("field", "assignments");

      for (const cid of overrides.customerIds ?? currentCustomerIds) {
        formData.append("customerIds", cid);
      }
      for (const ctid of overrides.customerTypeIds ?? currentCustomerTypeIds) {
        formData.append("customerTypeIds", ctid);
      }
      for (const sid of overrides.supplierIds ?? currentSupplierIds) {
        formData.append("supplierIds", sid);
      }
      for (const stid of overrides.supplierTypeIds ?? currentSupplierTypeIds) {
        formData.append("supplierTypeIds", stid);
      }

      assignmentFetcher.submit(formData, {
        method: "post",
        action: path.to.updatePriceList
      });
    },
    [
      id,
      currentCustomerIds,
      currentCustomerTypeIds,
      currentSupplierIds,
      currentSupplierTypeIds
    ]
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

        <ValidatedForm
          defaultValues={{ name: priceList?.name ?? undefined }}
          validator={z.object({ name: z.string().min(1) })}
          className="w-full"
        >
          <InputControlled
            label="Name"
            name="name"
            size="sm"
            inline
            isReadOnly={!canUpdate}
            value={priceList?.name ?? ""}
            onBlur={(e) => onUpdate("name", e.target.value ?? null)}
          />
        </ValidatedForm>
      </VStack>

      <div className="border-b border-border" />

      <ValidatedForm
        defaultValues={{ description: priceList?.description ?? undefined }}
        validator={z.object({ description: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <InputControlled
          label="Description"
          name="description"
          size="sm"
          inline
          isReadOnly={!canUpdate}
          value={priceList?.description ?? ""}
          onBlur={(e) => onUpdate("description", e.target.value ?? null)}
        />
      </ValidatedForm>

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
          isReadOnly={!canUpdate}
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
          isReadOnly={!canUpdate}
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
          isDisabled={!canUpdate}
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
          isDisabled={!canUpdate}
          onChange={(date) => onUpdate("validTo", date)}
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      {/* Assignments */}
      {isSales ? (
        <>
          <ValidatedForm
            defaultValues={{ customerIds: currentCustomerIds }}
            validator={z.object({
              customerIds: z.array(z.string()).optional()
            })}
            className="w-full"
          >
            <CreatableMultiSelect
              name="customerIds"
              label="Customers"
              options={customerOptions}
              value={currentCustomerIds}
              isReadOnly={!canUpdate}
              inline={inlinePreview}
              onChange={(selected) =>
                onSyncAssignments({ customerIds: selected })
              }
            />
          </ValidatedForm>

          <ValidatedForm
            defaultValues={{ customerTypeIds: currentCustomerTypeIds }}
            validator={z.object({
              customerTypeIds: z.array(z.string()).optional()
            })}
            className="w-full"
          >
            <CreatableMultiSelect
              name="customerTypeIds"
              label="Customer Types"
              options={customerTypeOptions}
              value={currentCustomerTypeIds}
              isReadOnly={!canUpdate}
              inline={inlinePreview}
              onChange={(selected) =>
                onSyncAssignments({ customerTypeIds: selected })
              }
            />
          </ValidatedForm>
        </>
      ) : (
        <>
          <ValidatedForm
            defaultValues={{ supplierIds: currentSupplierIds }}
            validator={z.object({
              supplierIds: z.array(z.string()).optional()
            })}
            className="w-full"
          >
            <CreatableMultiSelect
              name="supplierIds"
              label="Suppliers"
              options={supplierOptions}
              value={currentSupplierIds}
              isReadOnly={!canUpdate}
              inline={inlinePreview}
              onChange={(selected) =>
                onSyncAssignments({ supplierIds: selected })
              }
            />
          </ValidatedForm>

          <ValidatedForm
            defaultValues={{ supplierTypeIds: currentSupplierTypeIds }}
            validator={z.object({
              supplierTypeIds: z.array(z.string()).optional()
            })}
            className="w-full"
          >
            <CreatableMultiSelect
              name="supplierTypeIds"
              label="Supplier Types"
              options={supplierTypeOptions}
              value={currentSupplierTypeIds}
              isReadOnly={!canUpdate}
              inline={inlinePreview}
              onChange={(selected) =>
                onSyncAssignments({ supplierTypeIds: selected })
              }
            />
          </ValidatedForm>
        </>
      )}

      <div className="border-b border-border" />

      <VStack spacing={3}>
        <VStack spacing={1}>
          <p className="text-xs text-muted-foreground font-medium">Type</p>
          <span>{priceList?.type ?? "-"}</span>
        </VStack>

        <VStack spacing={1}>
          <p className="text-xs text-muted-foreground font-medium">Version</p>
          <span>v{priceList?.version ?? 1}</span>
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
