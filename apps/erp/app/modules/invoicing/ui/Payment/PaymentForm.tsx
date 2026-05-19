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
import { useState } from "react";
import type { z } from "zod";
import {
  Account,
  Currency,
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Number,
  Select,
  SequenceOrCustomId,
  Submit,
  Supplier,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  isPaymentLocked,
  paymentType,
  paymentValidator
} from "~/modules/invoicing";

type PaymentFormValues = z.infer<typeof paymentValidator>;

type PaymentFormProps = {
  initialValues: PaymentFormValues & { status?: string };
  // When set, a hidden field carries the seed invoice id through to
  // the action, which auto-creates a starter application against it.
  seedInvoiceId?: string;
  seedInvoiceExchangeRate?: number;
};

const PaymentForm = ({
  initialValues,
  seedInvoiceId,
  seedInvoiceExchangeRate
}: PaymentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = Boolean(initialValues.id);
  const isLocked = isPaymentLocked(initialValues.status);

  // The counterparty selector visibility tracks paymentType so users
  // see Customer for Receipts and Supplier for Disbursements.
  const [currentType, setCurrentType] = useState<"Receipt" | "Disbursement">(
    initialValues.paymentType ?? "Receipt"
  );

  const typeOptions = paymentType.map((t) => ({
    label:
      t === "Receipt" ? "Customer Receipt (AR)" : "Vendor Disbursement (AP)",
    value: t
  }));

  return (
    <ValidatedForm
      method="post"
      validator={paymentValidator}
      defaultValues={initialValues}
      isDisabled={isEditing && isLocked}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? <Trans>Payment</Trans> : <Trans>New Payment</Trans>}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                Record cash received from a customer (Receipt) or paid to a
                supplier (Disbursement). Applications to specific invoices are
                added after the payment is created.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          {seedInvoiceId && (
            <>
              <Hidden name="seedInvoiceId" value={seedInvoiceId} />
              <Hidden
                name="seedInvoiceExchangeRate"
                value={String(seedInvoiceExchangeRate ?? 1)}
              />
            </>
          )}
          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              {!isEditing && (
                <SequenceOrCustomId
                  name="paymentId"
                  label={t`Payment ID`}
                  table="payment"
                />
              )}
              <Select
                name="paymentType"
                label={t`Type`}
                options={typeOptions}
                onChange={(opt) => {
                  if (
                    opt?.value === "Receipt" ||
                    opt?.value === "Disbursement"
                  ) {
                    setCurrentType(opt.value);
                  }
                }}
              />
              {currentType === "Receipt" ? (
                <Customer name="customerId" label={t`Customer`} />
              ) : (
                <Supplier name="supplierId" label={t`Supplier`} />
              )}
              <DatePicker name="paymentDate" label={t`Payment Date`} />
              <Currency name="currencyCode" label={t`Currency`} />
              <Number name="exchangeRate" label={t`Exchange Rate (to base)`} />
              <Number name="totalAmount" label={t`Total Amount`} />
              <Account
                name="bankAccount"
                label={t`Bank / Cash Account`}
                classes={["Asset"]}
              />
              <Input name="reference" label={t`Reference`} />
              <div className="lg:col-span-3">
                <TextArea name="memo" label={t`Memo`} />
              </div>
              <CustomFormFields table="payment" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? isLocked || !permissions.can("update", "invoicing")
                : !permissions.can("create", "invoicing")
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PaymentForm;
