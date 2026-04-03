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
import { Currency } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { priceListPriceTypes, priceListStatusTypes } from "../pricing.models";
import type { PriceListDetail } from "../types";

const PriceListProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const permissions = usePermissions();

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  const priceList = routeData?.priceList;

  const permissionModule =
    priceList?.type === "Purchase" ? "purchasing" : "sales";

  const canUpdate = permissions.can("update", permissionModule);

  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    } else if (fetcher.data?.warning) {
      toast.warning(fetcher.data.warning);
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

        {/* Name field */}
        <ValidatedForm
          defaultValues={{
            name: priceList?.name ?? undefined
          }}
          validator={z.object({
            name: z.string().min(1)
          })}
          className="w-full"
        >
          <InputControlled
            label="Name"
            name="name"
            size="sm"
            inline
            isReadOnly={!canUpdate}
            value={priceList?.name ?? ""}
            onBlur={(e) => {
              onUpdate("name", e.target.value ?? null);
            }}
          />
        </ValidatedForm>
      </VStack>

      <div className="border-b border-border" />

      {/* Description */}
      <ValidatedForm
        defaultValues={{
          description: priceList?.description ?? undefined
        }}
        validator={z.object({
          description: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          label="Description"
          name="description"
          size="sm"
          inline
          isReadOnly={!canUpdate}
          value={priceList?.description ?? ""}
          onBlur={(e) => {
            onUpdate("description", e.target.value ?? null);
          }}
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      {/* Status */}
      <ValidatedForm
        defaultValues={{
          status: priceList?.status ?? ""
        }}
        validator={z.object({
          status: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={priceListStatusTypes.map((s) => ({
            value: s,
            label: <Enumerable value={s} />
          }))}
          isReadOnly={!canUpdate}
          label="Status"
          name="status"
          inline={(value) => <Enumerable value={value} />}
          onChange={(value) => {
            if (value) {
              onUpdate("status", value.value);
            }
          }}
        />
      </ValidatedForm>

      {/* Price Type */}
      <ValidatedForm
        defaultValues={{
          priceType: priceList?.priceType ?? ""
        }}
        validator={z.object({
          priceType: z.string().optional()
        })}
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
            if (value) {
              onUpdate("priceType", value.value);
            }
          }}
        />
      </ValidatedForm>

      {/* Currency */}
      <ValidatedForm
        defaultValues={{
          currencyCode: priceList?.currencyCode ?? undefined
        }}
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
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      {/* Valid From */}
      <ValidatedForm
        defaultValues={{
          validFrom: priceList?.validFrom ?? ""
        }}
        validator={z.object({
          validFrom: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <DatePicker
          name="validFrom"
          label="Valid From"
          inline
          isDisabled={!canUpdate}
          onChange={(date) => {
            onUpdate("validFrom", date);
          }}
        />
      </ValidatedForm>

      {/* Valid To */}
      <ValidatedForm
        defaultValues={{
          validTo: priceList?.validTo ?? ""
        }}
        validator={z.object({
          validTo: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <DatePicker
          name="validTo"
          label="Valid To"
          inline
          isDisabled={!canUpdate}
          onChange={(date) => {
            onUpdate("validTo", date);
          }}
        />
      </ValidatedForm>

      <div className="border-b border-border" />

      {/* Read-only info section */}
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
