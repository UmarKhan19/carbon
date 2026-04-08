import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  Hidden,
  PaymentTerm,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isQuoteLocked, quotePaymentValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type QuotePaymentFormProps = {
  initialValues: z.infer<typeof quotePaymentValidator>;
};

const QuotePaymentForm = ({ initialValues }: QuotePaymentFormProps) => {
  const { t } = useLingui();
  const { t: tShared } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.invoiceCustomerId
  );

  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));

  const isLocked = isQuoteLocked(routeData?.quote?.status);
  const isEditable = !isLocked;
  const isDisabled = !isEditable || !permissions.can("update", "sales");

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.quotePayment(initialValues.id)}
        validator={quotePaymentValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
        isDisabled={isLocked}
      >
        <CardHeader>
          <CardTitle>{t({ id: "Payment", message: "Payment" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer
              name="invoiceCustomerId"
              label={t({ id: "Invoice Customer", message: "Invoice Customer" })}
              onChange={(value) => setCustomer(value?.value as string)}
            />
            <CustomerLocation
              name="invoiceCustomerLocationId"
              label={t({ id: "Invoice Location", message: "Invoice Location" })}
              customer={customer}
            />
            <CustomerContact
              name="invoiceCustomerContactId"
              label={t({ id: "Invoice Contact", message: "Invoice Contact" })}
              customer={customer}
            />

            <PaymentTerm
              name="paymentTermId"
              label={t({ id: "Payment Term", message: "Payment Term" })}
            />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              {tShared({ id: "Save", message: "Save" })}
            </Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuotePaymentForm;
