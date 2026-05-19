import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { DatePicker, Hidden, Input, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { paymentApplicationValidator } from "~/modules/invoicing";
import { path } from "~/utils/path";

type ApplicationFormValues = z.infer<typeof paymentApplicationValidator>;

type PaymentApplicationFormProps = {
  paymentId: string;
  paymentType: "Receipt" | "Disbursement";
  defaultPaymentExchangeRate?: number;
  initialValues?: Partial<ApplicationFormValues>;
};

const PaymentApplicationForm = ({
  paymentId,
  paymentType,
  defaultPaymentExchangeRate,
  initialValues
}: PaymentApplicationFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isReceipt = paymentType === "Receipt";
  const today = new Date().toISOString().slice(0, 10);

  const defaults: ApplicationFormValues = {
    id: initialValues?.id,
    paymentId,
    salesInvoiceId: initialValues?.salesInvoiceId,
    purchaseInvoiceId: initialValues?.purchaseInvoiceId,
    appliedAmount: initialValues?.appliedAmount ?? 0,
    discountAmount: initialValues?.discountAmount ?? 0,
    writeOffAmount: initialValues?.writeOffAmount ?? 0,
    invoiceExchangeRate: initialValues?.invoiceExchangeRate ?? 1,
    paymentExchangeRate:
      initialValues?.paymentExchangeRate ?? defaultPaymentExchangeRate ?? 1,
    appliedDate: initialValues?.appliedDate ?? today
  };

  return (
    <ValidatedForm
      method="post"
      action={path.to.paymentApplicationsNew(paymentId)}
      validator={paymentApplicationValidator}
      defaultValues={defaults}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Add Application</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Apply this payment to an open invoice. Principal, discount, and
              write-off are all in invoice currency. FX gain/loss is computed
              from the rate delta.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="paymentId" />
          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              {isReceipt ? (
                <>
                  <Input name="salesInvoiceId" label={t`Sales Invoice ID`} />
                  <Hidden name="purchaseInvoiceId" value="" />
                </>
              ) : (
                <>
                  <Input
                    name="purchaseInvoiceId"
                    label={t`Purchase Invoice ID`}
                  />
                  <Hidden name="salesInvoiceId" value="" />
                </>
              )}
              <DatePicker name="appliedDate" label={t`Applied Date`} />
              <Number name="appliedAmount" label={t`Applied Amount`} />
              <Number name="discountAmount" label={t`Discount`} />
              <Number name="writeOffAmount" label={t`Write-Off`} />
              <Number
                name="invoiceExchangeRate"
                label={t`Invoice Exchange Rate`}
              />
              <Number
                name="paymentExchangeRate"
                label={t`Payment Exchange Rate`}
              />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("create", "invoicing")}>
            <Trans>Add</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PaymentApplicationForm;
