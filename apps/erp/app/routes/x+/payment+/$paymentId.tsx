import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getPayment,
  getPaymentApplications,
  isPaymentLocked,
  PaymentApplicationForm
} from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "invoicing" });
  const { paymentId } = params;
  if (!paymentId) throw notFound("Missing paymentId");

  const [payment, applications] = await Promise.all([
    getPayment(client, paymentId),
    getPaymentApplications(client, paymentId)
  ]);

  if (payment.error || !payment.data) {
    throw redirect(
      path.to.payments,
      await flash(request, error(payment.error, "Failed to load payment"))
    );
  }

  return {
    payment: payment.data,
    applications: applications.data ?? []
  };
}

export default function PaymentDetailRoute() {
  const { payment, applications } = useLoaderData<typeof loader>();
  const post = useFetcher();
  const voidFetcher = useFetcher();
  const locked = isPaymentLocked(payment.status);

  const totalApplied = applications.reduce(
    (sum, a) =>
      sum +
      Number(a.appliedAmount) +
      Number(a.discountAmount) +
      Number(a.writeOffAmount),
    0
  );
  const unapplied =
    Number(payment.totalAmount) -
    applications.reduce((s, a) => s + Number(a.appliedAmount), 0);

  return (
    <VStack spacing={4} className="p-6 max-w-6xl">
      <HStack className="justify-between w-full">
        <div>
          <Heading size="h2">
            {payment.paymentId}{" "}
            <span className="text-muted-foreground text-base">
              ({payment.paymentType})
            </span>
          </Heading>
          <p className="text-sm text-muted-foreground">
            <Trans>Status:</Trans> <strong>{payment.status}</strong>
          </p>
        </div>
        <HStack>
          {payment.status === "Draft" && (
            <post.Form method="post" action={path.to.paymentPost(payment.id)}>
              <button
                type="submit"
                className="bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm hover:opacity-90"
                disabled={post.state !== "idle"}
              >
                <Trans>Post</Trans>
              </button>
            </post.Form>
          )}
          {payment.status === "Posted" && (
            <voidFetcher.Form
              method="post"
              action={path.to.paymentVoid(payment.id)}
            >
              <button
                type="submit"
                className="bg-destructive text-destructive-foreground rounded px-3 py-1.5 text-sm hover:opacity-90"
                disabled={voidFetcher.state !== "idle"}
              >
                <Trans>Void</Trans>
              </button>
            </voidFetcher.Form>
          )}
        </HStack>
      </HStack>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Details</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            <DetailField label="Counterparty">
              {payment.customerId ?? payment.supplierId ?? "—"}
            </DetailField>
            <DetailField label="Payment Date">
              {payment.paymentDate}
            </DetailField>
            <DetailField label="Total Amount">
              {Number(payment.totalAmount).toFixed(2)} {payment.currencyCode}
            </DetailField>
            <DetailField label="Exchange Rate">
              {payment.exchangeRate}
            </DetailField>
            <DetailField label="Bank Account">
              {payment.bankAccount}
            </DetailField>
            <DetailField label="Reference">
              {payment.reference ?? "—"}
            </DetailField>
            {payment.memo && (
              <div className="lg:col-span-3">
                <DetailField label="Memo">{payment.memo}</DetailField>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Applications</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Invoice</th>
                <th className="text-right p-3">Applied</th>
                <th className="text-right p-3">Discount</th>
                <th className="text-right p-3">Write-Off</th>
                <th className="text-right p-3">Inv Rate</th>
                <th className="text-right p-3">Pay Rate</th>
                <th className="text-right p-3">FX G/L</th>
                <th className="text-left p-3">Applied Date</th>
              </tr>
            </thead>
            <tbody>
              {applications.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-6 text-center text-muted-foreground"
                  >
                    <Trans>No applications. Payment will be on-account.</Trans>
                  </td>
                </tr>
              ) : (
                applications.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="p-3">
                      {a.salesInvoiceId ?? a.purchaseInvoiceId}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {Number(a.appliedAmount).toFixed(2)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {Number(a.discountAmount).toFixed(2)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {Number(a.writeOffAmount).toFixed(2)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {a.invoiceExchangeRate}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {a.paymentExchangeRate}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {Number(a.fxGainLossAmount ?? 0).toFixed(2)}
                    </td>
                    <td className="p-3">{a.appliedDate}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="border-t border-border bg-muted/20 text-xs">
              <tr>
                <td className="p-3 text-right" colSpan={1}>
                  <strong>
                    <Trans>Totals</Trans>
                  </strong>
                </td>
                <td className="p-3 text-right tabular-nums">
                  <strong>{totalApplied.toFixed(2)}</strong>
                </td>
                <td colSpan={5} />
                <td className="p-3 text-right tabular-nums">
                  <Trans>Unapplied:</Trans> {unapplied.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {!locked && (
        <PaymentApplicationForm
          paymentId={payment.id}
          paymentType={payment.paymentType}
          defaultPaymentExchangeRate={Number(payment.exchangeRate)}
        />
      )}
    </VStack>
  );
}

function DetailField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}
