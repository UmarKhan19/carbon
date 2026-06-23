import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuListChecks, LuRotateCcw, LuSave } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EditableNumber } from "~/components/Editable";
import { Enumerable } from "~/components/Enumerable";
import Grid from "~/components/Grid";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";

// One row in the apply table — an open invoice for the payment's
// counterparty, plus the user's selection + entered amounts.
type OpenInvoice = {
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  balance: number;
  status: string | null;
};

type ExistingApplication = {
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  invoiceExchangeRate: number;
  paymentExchangeRate: number;
  appliedDate: string;
};

// Grid row: the invoice's read-only fields plus the editable selection state.
type ApplyRow = {
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  balance: number;
  checked: boolean;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
};

type PaymentApplyTableProps = {
  paymentId: string;
  paymentType: "Receipt" | "Disbursement";
  paymentCurrency: string;
  paymentTotal: number;
  paymentExchangeRate: number;
  openInvoices: OpenInvoice[];
  existingApplications: ExistingApplication[];
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

const PaymentApplyTable = ({
  paymentId,
  paymentType,
  paymentCurrency,
  paymentTotal,
  paymentExchangeRate,
  openInvoices,
  existingApplications
}: PaymentApplyTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const currencyFormatter = useCurrencyFormatter({ currency: paymentCurrency });
  const { formatDate } = useDateFormatter();
  const today = new Date().toISOString().slice(0, 10);
  const isReceipt = paymentType === "Receipt";
  const canEdit = permissions.can("update", "invoicing");

  // Seed rows from existing applications so users see what's already
  // applied when they reopen a Draft payment.
  const seed = useMemo<ApplyRow[]>(() => {
    const byInvoice = new Map<string, ExistingApplication>();
    for (const a of existingApplications) {
      const id = isReceipt ? a.salesInvoiceId : a.purchaseInvoiceId;
      if (id) byInvoice.set(id, a);
    }
    return openInvoices.map((inv) => {
      const existing = byInvoice.get(inv.id);
      return {
        id: inv.id,
        invoiceId: inv.invoiceId,
        dateDue: inv.dateDue,
        currencyCode: inv.currencyCode,
        exchangeRate: inv.exchangeRate,
        balance: inv.balance,
        checked: Boolean(existing),
        appliedAmount: existing?.appliedAmount ?? 0,
        discountAmount: existing?.discountAmount ?? 0,
        writeOffAmount: existing?.writeOffAmount ?? 0
      };
    });
  }, [openInvoices, existingApplications, isReceipt]);

  const [rows, setRows] = useState<ApplyRow[]>(seed);

  const totalCash = useMemo(
    () => rows.reduce((sum, r) => (r.checked ? sum + r.appliedAmount : sum), 0),
    [rows]
  );
  const unapplied = paymentTotal - totalCash;
  const overApplied = totalCash > paymentTotal + 0.0001;

  const toggleRow = useCallback(
    (id: string, checked: boolean) =>
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          // Checking an empty row auto-fills the applied amount with the
          // open balance (capped at the payment total). Unchecking zeroes it.
          if (checked) {
            return {
              ...r,
              checked: true,
              appliedAmount:
                r.appliedAmount === 0
                  ? round4(Math.min(r.balance, paymentTotal))
                  : r.appliedAmount
            };
          }
          return {
            ...r,
            checked: false,
            appliedAmount: 0,
            discountAmount: 0,
            writeOffAmount: 0
          };
        })
      ),
    [paymentTotal]
  );

  // Grid cell edits flow back here. Entering any amount auto-checks the row
  // so it's included on save (mirrors the check-to-apply affordance).
  const onDataChange = useCallback(
    (next: ApplyRow[]) =>
      setRows(
        next.map((r) => ({
          ...r,
          checked:
            r.checked ||
            r.appliedAmount + r.discountAmount + r.writeOffAmount > 0
        }))
      ),
    []
  );

  const onAutoApply = useCallback(() => {
    // Distribute payment cash oldest-first (openInvoices is already sorted by
    // dateDue ascending from the loader).
    let remaining = paymentTotal;
    setRows((prev) =>
      prev.map((r) => {
        if (remaining <= 0) {
          return { ...r, checked: false, appliedAmount: 0 };
        }
        const take = Math.min(remaining, r.balance);
        remaining = round4(remaining - take);
        return { ...r, checked: true, appliedAmount: round4(take) };
      })
    );
  }, [paymentTotal]);

  const onClear = useCallback(
    () =>
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          checked: false,
          appliedAmount: 0,
          discountAmount: 0,
          writeOffAmount: 0
        }))
      ),
    []
  );

  const onSave = () => {
    const applications = rows
      .filter(
        (r) =>
          r.checked && r.appliedAmount + r.discountAmount + r.writeOffAmount > 0
      )
      .map((r) => ({
        salesInvoiceId: isReceipt ? r.id : undefined,
        purchaseInvoiceId: isReceipt ? undefined : r.id,
        appliedAmount: r.appliedAmount,
        discountAmount: r.discountAmount,
        writeOffAmount: r.writeOffAmount,
        invoiceExchangeRate: r.exchangeRate || 1,
        paymentExchangeRate: paymentExchangeRate || 1,
        appliedDate: today
      }));

    const formData = new FormData();
    formData.set("applications", JSON.stringify(applications));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.paymentApplicationsSet(paymentId)
    });
  };

  const noOpMutation = useCallback(
    async (_accessorKey: string, _newValue: unknown, _row: ApplyRow) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      }) as PostgrestSingleResponse<unknown>,
    []
  );

  const editableComponents = useMemo(
    () => ({
      appliedAmount: EditableNumber<ApplyRow>(noOpMutation, {
        minValue: 0,
        formatOptions: { minimumFractionDigits: 2, maximumFractionDigits: 4 }
      }),
      discountAmount: EditableNumber<ApplyRow>(noOpMutation, {
        minValue: 0,
        formatOptions: { minimumFractionDigits: 2, maximumFractionDigits: 4 }
      }),
      writeOffAmount: EditableNumber<ApplyRow>(noOpMutation, {
        minValue: 0,
        formatOptions: { minimumFractionDigits: 2, maximumFractionDigits: 4 }
      })
    }),
    [noOpMutation]
  );

  const columns = useMemo<ColumnDef<ApplyRow>[]>(
    () => [
      {
        accessorKey: "checked",
        header: "",
        cell: ({ row }) => (
          <Checkbox
            checked={row.original.checked}
            onCheckedChange={(checked) =>
              toggleRow(row.original.id, Boolean(checked))
            }
            onClick={(e) => e.stopPropagation()}
            disabled={!canEdit}
          />
        )
      },
      {
        accessorKey: "invoiceId",
        header: t`Invoice`,
        cell: ({ row }) => row.original.invoiceId
      },
      {
        accessorKey: "dateDue",
        header: t`Due`,
        cell: ({ row }) =>
          row.original.dateDue ? formatDate(row.original.dateDue) : "—"
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: ({ row }) => <Enumerable value={row.original.currencyCode} />
      },
      {
        accessorKey: "balance",
        header: t`Open`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(row.original.balance))}
          </span>
        )
      },
      {
        accessorKey: "appliedAmount",
        header: t`Applied`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(row.original.appliedAmount))}
          </span>
        )
      },
      {
        accessorKey: "discountAmount",
        header: t`Discount`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(row.original.discountAmount))}
          </span>
        )
      },
      {
        accessorKey: "writeOffAmount",
        header: t`Write-Off`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(row.original.writeOffAmount))}
          </span>
        )
      }
    ],
    [canEdit, toggleRow, formatDate, t, currencyFormatter]
  );

  const isSaving = fetcher.state !== "idle";

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between w-full">
          <div>
            <CardTitle>
              <Trans>Apply To Invoices</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Check the invoices this payment settles. Discount and write-off
                are in invoice currency.
              </Trans>
            </CardDescription>
          </div>
          <HStack>
            <Button
              variant="secondary"
              leftIcon={<LuListChecks />}
              onClick={onAutoApply}
              isDisabled={!canEdit || openInvoices.length === 0}
            >
              <Trans>Auto Apply</Trans>
            </Button>
            <Button
              variant="secondary"
              leftIcon={<LuRotateCcw />}
              onClick={onClear}
              isDisabled={!canEdit}
            >
              <Trans>Clear</Trans>
            </Button>
          </HStack>
        </HStack>
      </CardHeader>
      <CardContent>
        {openInvoices.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">
            <Trans>
              No open invoices for this counterparty. Payment will be
              on-account.
            </Trans>
          </p>
        ) : (
          <Grid<ApplyRow>
            data={rows}
            columns={columns}
            canEdit={canEdit}
            editableComponents={editableComponents}
            onDataChange={onDataChange}
            withSimpleSorting={false}
            contained={false}
          />
        )}
      </CardContent>
      <CardFooter>
        <HStack className="justify-between w-full">
          <span className="text-muted-foreground">
            {overApplied ? (
              <span className="text-destructive font-semibold">
                <Trans>Over-applied by</Trans>{" "}
                {currencyFormatter.format(totalCash - paymentTotal)}
              </span>
            ) : (
              <>
                <Trans>Applied</Trans>{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {currencyFormatter.format(totalCash)}
                </span>
                {" · "}
                <Trans>Unapplied</Trans>{" "}
                <span className="tabular-nums">
                  {currencyFormatter.format(unapplied)}
                </span>
              </>
            )}
          </span>
          <Button
            leftIcon={<LuSave />}
            onClick={onSave}
            isLoading={isSaving}
            isDisabled={!canEdit || overApplied}
          >
            <Trans>Save Applications</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
};

export default PaymentApplyTable;
