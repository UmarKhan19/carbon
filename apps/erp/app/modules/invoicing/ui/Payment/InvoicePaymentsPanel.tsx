import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";

// Row shape returned by getPaymentApplicationsForInvoice (after the
// service's two-step merge).
type InvoicePaymentRow = {
  id: string;
  paymentId: string;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number | null;
  appliedDate: string;
  payment: {
    id: string;
    paymentId: string;
    status: string | null;
    paymentDate: string | null;
    currencyCode: string;
  };
};

type InvoicePaymentsPanelProps = {
  rows: InvoicePaymentRow[];
};

const InvoicePaymentsPanel = ({ rows }: InvoicePaymentsPanelProps) => {
  const { formatDate } = useDateFormatter();
  // Payment currency varies row-to-row; use the base formatter and let
  // the currency column display the code for clarity.
  const currencyFormatter = useCurrencyFormatter();

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Payments</Trans>{" "}
          <span className="text-muted-foreground text-base">
            ({rows.length})
          </span>
        </CardTitle>
        <CardDescription>
          <Trans>
            Posted payments that have applied to this invoice. Click a row to
            open the payment.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Date</Trans>
              </Th>
              <Th>
                <Trans>Payment</Trans>
              </Th>
              <Th>
                <Trans>Currency</Trans>
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
              <Th className="text-right">
                <Trans>FX G/L</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>{formatDate(r.appliedDate)}</Td>
                <Td>
                  <Link
                    to={path.to.payment(r.payment.id)}
                    className="text-primary hover:underline"
                  >
                    {r.payment.paymentId}
                  </Link>
                </Td>
                <Td>
                  <Enumerable value={r.payment.currencyCode} />
                </Td>
                <Td className="text-right tabular-nums">
                  {Number(r.appliedAmount).toFixed(2)}
                </Td>
                <Td className="text-right tabular-nums">
                  {Number(r.discountAmount).toFixed(2)}
                </Td>
                <Td className="text-right tabular-nums">
                  {Number(r.writeOffAmount).toFixed(2)}
                </Td>
                <Td className="text-right tabular-nums">
                  {currencyFormatter.format(Number(r.fxGainLossAmount ?? 0))}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default InvoicePaymentsPanel;
