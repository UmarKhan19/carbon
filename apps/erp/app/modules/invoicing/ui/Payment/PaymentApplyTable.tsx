import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  HStack,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuListChecks, LuRotateCcw, LuSave } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";

// One row in the apply table — an open invoice for the payment's
// counterparty, plus the user's selection state.
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

type RowState = {
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

const PaymentApplyTable = ({
  paymentId,
  paymentType,
  paymentCurrency,
  paymentTotal,
  paymentExchangeRate,
  openInvoices,
  existingApplications
}: PaymentApplyTableProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const currencyFormatter = useCurrencyFormatter({ currency: paymentCurrency });
  const { formatDate } = useDateFormatter();
  const today = new Date().toISOString().slice(0, 10);
  const isReceipt = paymentType === "Receipt";

  // Seed row state from existing applications so users see what's
  // already applied when they reopen a Draft payment.
  const seed = useMemo(() => {
    const byInvoice = new Map<string, ExistingApplication>();
    for (const a of existingApplications) {
      const id = isReceipt ? a.salesInvoiceId : a.purchaseInvoiceId;
      if (id) byInvoice.set(id, a);
    }
    const initial: Record<string, RowState> = {};
    for (const inv of openInvoices) {
      const existing = byInvoice.get(inv.id);
      initial[inv.id] = existing
        ? {
            checked: true,
            appliedAmount: existing.appliedAmount,
            discountAmount: existing.discountAmount,
            writeOffAmount: existing.writeOffAmount
          }
        : {
            checked: false,
            appliedAmount: 0,
            discountAmount: 0,
            writeOffAmount: 0
          };
    }
    return initial;
  }, [openInvoices, existingApplications, isReceipt]);

  const [rows, setRows] = useState<Record<string, RowState>>(seed);

  const updateRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const _totalApplied = useMemo(
    () =>
      Object.values(rows).reduce(
        (sum, r) =>
          r.checked
            ? sum + r.appliedAmount + r.discountAmount + r.writeOffAmount
            : sum,
        0
      ),
    [rows]
  );
  const totalCash = useMemo(
    () =>
      Object.values(rows).reduce(
        (sum, r) => (r.checked ? sum + r.appliedAmount : sum),
        0
      ),
    [rows]
  );
  const unapplied = paymentTotal - totalCash;
  const overApplied = totalCash > paymentTotal + 0.0001;

  const onAutoApply = () => {
    // Distribute payment cash oldest-first (openInvoices is already
    // sorted by dateDue ascending from the loader).
    let remaining = paymentTotal;
    const next: Record<string, RowState> = {};
    for (const inv of openInvoices) {
      if (remaining <= 0) {
        next[inv.id] = {
          checked: false,
          appliedAmount: 0,
          discountAmount: 0,
          writeOffAmount: 0
        };
        continue;
      }
      const take = Math.min(remaining, inv.balance);
      next[inv.id] = {
        checked: true,
        appliedAmount: round4(take),
        discountAmount: 0,
        writeOffAmount: 0
      };
      remaining = round4(remaining - take);
    }
    setRows(next);
  };

  const onClear = () => {
    const next: Record<string, RowState> = {};
    for (const inv of openInvoices) {
      next[inv.id] = {
        checked: false,
        appliedAmount: 0,
        discountAmount: 0,
        writeOffAmount: 0
      };
    }
    setRows(next);
  };

  const onSave = () => {
    const applications = openInvoices
      .filter((inv) => {
        const r = rows[inv.id];
        return (
          r?.checked &&
          r.appliedAmount + r.discountAmount + r.writeOffAmount > 0
        );
      })
      .map((inv) => {
        const r = rows[inv.id];
        return {
          salesInvoiceId: isReceipt ? inv.id : undefined,
          purchaseInvoiceId: isReceipt ? undefined : inv.id,
          appliedAmount: r.appliedAmount,
          discountAmount: r.discountAmount,
          writeOffAmount: r.writeOffAmount,
          invoiceExchangeRate: inv.exchangeRate || 1,
          paymentExchangeRate: paymentExchangeRate || 1,
          appliedDate: today
        };
      });

    const formData = new FormData();
    formData.set("applications", JSON.stringify(applications));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.paymentApplicationsSet(paymentId)
    });
  };

  const canEdit = permissions.can("update", "invoicing");
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
        <Table>
          <Thead>
            <Tr>
              <Th className="w-[40px]" />
              <Th>
                <Trans>Invoice</Trans>
              </Th>
              <Th>
                <Trans>Due</Trans>
              </Th>
              <Th>
                <Trans>Currency</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Open</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Applied</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Discount</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Write-Off</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {openInvoices.length === 0 ? (
              <Tr>
                <Td colSpan={8} className="text-center text-muted-foreground">
                  <Trans>
                    No open invoices for this counterparty. Payment will be
                    on-account.
                  </Trans>
                </Td>
              </Tr>
            ) : (
              openInvoices.map((inv) => {
                const r = rows[inv.id] ?? {
                  checked: false,
                  appliedAmount: 0,
                  discountAmount: 0,
                  writeOffAmount: 0
                };
                return (
                  <Tr key={inv.id}>
                    <Td>
                      <Checkbox
                        checked={r.checked}
                        onCheckedChange={(checked) =>
                          updateRow(inv.id, {
                            checked: Boolean(checked),
                            appliedAmount:
                              checked && r.appliedAmount === 0
                                ? round4(Math.min(inv.balance, paymentTotal))
                                : r.appliedAmount
                          })
                        }
                        disabled={!canEdit}
                      />
                    </Td>
                    <Td>{inv.invoiceId}</Td>
                    <Td>{inv.dateDue ? formatDate(inv.dateDue) : "—"}</Td>
                    <Td>
                      <Enumerable value={inv.currencyCode} />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {Number(inv.balance).toFixed(2)}
                    </Td>
                    <Td className="text-right">
                      <NumericCell
                        value={r.appliedAmount}
                        onChange={(v) =>
                          updateRow(inv.id, { appliedAmount: v })
                        }
                        isDisabled={!canEdit || !r.checked}
                      />
                    </Td>
                    <Td className="text-right">
                      <NumericCell
                        value={r.discountAmount}
                        onChange={(v) =>
                          updateRow(inv.id, { discountAmount: v })
                        }
                        isDisabled={!canEdit || !r.checked}
                      />
                    </Td>
                    <Td className="text-right">
                      <NumericCell
                        value={r.writeOffAmount}
                        onChange={(v) =>
                          updateRow(inv.id, { writeOffAmount: v })
                        }
                        isDisabled={!canEdit || !r.checked}
                      />
                    </Td>
                  </Tr>
                );
              })
            )}
          </Tbody>
          <Tfoot>
            <Tr>
              <Td colSpan={5} className="text-right font-semibold">
                <Trans>Totals</Trans>
              </Td>
              <Td className="text-right tabular-nums font-semibold">
                {currencyFormatter.format(totalCash)}
              </Td>
              <Td colSpan={2} className="text-right text-muted-foreground">
                {overApplied ? (
                  <span className="text-destructive font-semibold">
                    <Trans>Over-applied by</Trans>{" "}
                    {currencyFormatter.format(totalCash - paymentTotal)}
                  </span>
                ) : (
                  <>
                    <Trans>Unapplied:</Trans>{" "}
                    {currencyFormatter.format(unapplied)}
                  </>
                )}
              </Td>
            </Tr>
          </Tfoot>
        </Table>
      </CardContent>
      <CardFooter>
        <HStack className="justify-end w-full">
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

function NumericCell({
  value,
  onChange,
  isDisabled
}: {
  value: number;
  onChange: (next: number) => void;
  isDisabled?: boolean;
}) {
  return (
    <NumberField
      value={value}
      onChange={(v) => onChange(Number.isFinite(v) ? v : 0)}
      isDisabled={isDisabled}
      minValue={0}
      formatOptions={{
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      }}
    >
      <NumberInput className="text-right tabular-nums" />
    </NumberField>
  );
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export default PaymentApplyTable;
