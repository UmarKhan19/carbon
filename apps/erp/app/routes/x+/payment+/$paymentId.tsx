import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCheckCheck, LuTicketX } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { CustomerAvatar, SupplierAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import {
  getPayment,
  getPaymentApplications,
  isPaymentLocked,
  PaymentApplicationForm,
  PaymentStatus
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
  const permissions = usePermissions();
  const { payment, applications } = useLoaderData<typeof loader>();
  const post = useFetcher();
  const voidFetcher = useFetcher();
  const currencyFormatter = useCurrencyFormatter({
    currency: payment.currencyCode
  });
  const { formatDate } = useDateFormatter();
  const locked = isPaymentLocked(payment.status);
  const canMutate = permissions.can("update", "invoicing");

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
        <HStack spacing={2}>
          <Heading size="h2">{payment.paymentId}</Heading>
          <Enumerable value={payment.paymentType} />
          <PaymentStatus status={payment.status} />
        </HStack>
        <HStack>
          {payment.status === "Draft" && (
            <Button
              leftIcon={<LuCheckCheck />}
              variant="primary"
              isLoading={post.state !== "idle"}
              isDisabled={!canMutate}
              onClick={() =>
                post.submit(null, {
                  method: "post",
                  action: path.to.paymentPost(payment.id)
                })
              }
            >
              <Trans>Post</Trans>
            </Button>
          )}
          {payment.status === "Posted" && (
            <Button
              leftIcon={<LuTicketX />}
              variant="destructive"
              isLoading={voidFetcher.state !== "idle"}
              isDisabled={!canMutate}
              onClick={() =>
                voidFetcher.submit(null, {
                  method: "post",
                  action: path.to.paymentVoid(payment.id)
                })
              }
            >
              <Trans>Void</Trans>
            </Button>
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
          <Table>
            <Tbody>
              <Tr>
                <Td>
                  <Trans>Counterparty</Trans>
                </Td>
                <Td className="text-right">
                  {payment.customerId ? (
                    <CustomerAvatar customerId={payment.customerId} />
                  ) : payment.supplierId ? (
                    <SupplierAvatar supplierId={payment.supplierId} />
                  ) : (
                    "—"
                  )}
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Trans>Payment Date</Trans>
                </Td>
                <Td className="text-right">
                  {formatDate(payment.paymentDate)}
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Trans>Total Amount</Trans>
                </Td>
                <Td className="text-right tabular-nums">
                  {currencyFormatter.format(Number(payment.totalAmount))}
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Trans>Currency</Trans>
                </Td>
                <Td className="text-right">
                  <Enumerable value={payment.currencyCode} />
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Trans>Exchange Rate</Trans>
                </Td>
                <Td className="text-right tabular-nums">
                  {payment.exchangeRate}
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Trans>Bank Account</Trans>
                </Td>
                <Td className="text-right">{payment.bankAccount}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Trans>Reference</Trans>
                </Td>
                <Td className="text-right">{payment.reference ?? "—"}</Td>
              </Tr>
              {payment.memo && (
                <Tr>
                  <Td>
                    <Trans>Memo</Trans>
                  </Td>
                  <Td className="text-right whitespace-pre-wrap">
                    {payment.memo}
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Applications</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Invoice</Trans>
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
                  <Trans>Inv Rate</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Pay Rate</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>FX G/L</Trans>
                </Th>
                <Th>
                  <Trans>Applied Date</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {applications.length === 0 ? (
                <Tr>
                  <Td colSpan={8} className="text-center text-muted-foreground">
                    <Trans>No applications. Payment will be on-account.</Trans>
                  </Td>
                </Tr>
              ) : (
                applications.map((a) => (
                  <Tr key={a.id}>
                    <Td>{a.salesInvoiceId ?? a.purchaseInvoiceId}</Td>
                    <Td className="text-right tabular-nums">
                      {Number(a.appliedAmount).toFixed(2)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {Number(a.discountAmount).toFixed(2)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {Number(a.writeOffAmount).toFixed(2)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {a.invoiceExchangeRate}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {a.paymentExchangeRate}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {Number(a.fxGainLossAmount ?? 0).toFixed(2)}
                    </Td>
                    <Td>{formatDate(a.appliedDate)}</Td>
                  </Tr>
                ))
              )}
            </Tbody>
            {applications.length > 0 && (
              <Tfoot>
                <Tr>
                  <Td className="text-right font-semibold">
                    <Trans>Totals</Trans>
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {totalApplied.toFixed(2)}
                  </Td>
                  <Td colSpan={5} />
                  <Td className="text-right tabular-nums">
                    <Trans>Unapplied:</Trans> {unapplied.toFixed(2)}
                  </Td>
                </Tr>
              </Tfoot>
            )}
          </Table>
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
