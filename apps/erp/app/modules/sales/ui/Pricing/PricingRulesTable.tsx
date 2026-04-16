import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuCalendar,
  LuCopy,
  LuFilter,
  LuPencil,
  LuTag,
  LuToggleLeft,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useUrlParams
} from "~/hooks";
import { path } from "~/utils/path";
import type { PricingRule } from "../../types";

type PricingRulesTableProps = {
  data: PricingRule[];
  count: number;
};

const PricingRulesTable = memo(({ data, count }: PricingRulesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const fetcher = useFetcher();

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.pricingRule(row.original.id)}?${params.toString()}`}
          >
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          icon: <LuTag />
        }
      },
      {
        accessorKey: "ruleType",
        header: t`Type`,
        cell: ({ row }) => {
          const { amount, amountType, ruleType } = row.original;
          return (
            <Badge
              variant={ruleType === "Discount" ? "red" : "green"}
              className=" items-center gap-1"
            >
              {amountType === "Percentage" ? (
                <span>{percentFormatter.format(amount)}</span>
              ) : (
                <span>{currencyFormatter.format(amount)}</span>
              )}
              {ruleType === "Discount" ? <LuArrowDown /> : <LuArrowUp />}
            </Badge>
          );
        }
      },
      {
        id: "scope",
        header: t`Scope`,
        cell: ({ row }) => {
          const conditions: string[] = [];
          const rule = row.original;

          if (rule.minQuantity !== null && rule.minQuantity !== undefined) {
            conditions.push(`Qty >= ${rule.minQuantity}`);
          }
          if (
            rule.customerTypeIds !== null &&
            rule.customerTypeIds !== undefined &&
            rule.customerTypeIds.length > 0
          ) {
            conditions.push("Customer Type");
          }
          if (
            rule.itemPostingGroupId !== null &&
            rule.itemPostingGroupId !== undefined
          ) {
            conditions.push("Item Group");
          }
          if (
            rule.itemIds !== null &&
            rule.itemIds !== undefined &&
            rule.itemIds.length > 0
          ) {
            conditions.push(
              rule.itemIds.length === 1
                ? "Specific Item"
                : `${rule.itemIds.length} Items`
            );
          }

          if (conditions.length === 0) {
            return (
              <span className="text-muted-foreground text-sm">{t`All`}</span>
            );
          }
          return <span className="text-sm">{conditions.join(", ")}</span>;
        },
        meta: {
          icon: <LuFilter />
        }
      },
      {
        id: "dates",
        header: t`Dates`,
        cell: ({ row }) => {
          const { validFrom, validTo } = row.original;
          if (!validFrom && !validTo) {
            return (
              <span className="text-muted-foreground text-sm">{t`Always`}</span>
            );
          }
          const from = validFrom ? formatDate(validFrom) : "…";
          const to = validTo ? formatDate(validTo) : "…";
          return <span className="text-sm">{`${from} – ${to}`}</span>;
        },
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "green" : "gray"}>
            {row.original.active ? t`Active` : t`Inactive`}
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: t`Active` },
              { value: "false", label: t`Inactive` }
            ]
          },
          icon: <LuToggleLeft />
        }
      }
    ];
    return defaultColumns;
  }, [currencyFormatter, params, percentFormatter, t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "sales")}
            onClick={() => {
              navigate(`${path.to.pricingRule(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {t`Edit Pricing Rule`}
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("create", "sales")}
            onClick={() => {
              fetcher.submit(
                { intent: "duplicate" },
                {
                  method: "POST",
                  action: path.to.pricingRule(row.id)
                }
              );
            }}
          >
            <MenuIcon icon={<LuCopy />} />
            {t`Duplicate Pricing Rule`}
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deletePricingRule(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            {t`Delete Pricing Rule`}
          </MenuItem>
        </>
      );
    },
    [fetcher, navigate, params, permissions, t]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label={t`Pricing Rule`}
            to={`${path.to.newPricingRule}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Pricing Rules`}
    />
  );
});

PricingRulesTable.displayName = "PricingRulesTable";
export default PricingRulesTable;
