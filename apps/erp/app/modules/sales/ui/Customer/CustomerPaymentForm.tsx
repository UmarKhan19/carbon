import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  Hidden,
  Submit
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { usePermissions } from "~/hooks";
import { customerPaymentValidator } from "../../sales.models";

type CustomerPaymentFormProps = {
  initialValues: z.infer<typeof customerPaymentValidator>;
};

const CustomerPaymentForm = ({ initialValues }: CustomerPaymentFormProps) => {
  const { _: t } = useLingui();
  const { _: tShared } = useLingui();
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.invoiceCustomerId
  );

  const isDisabled = !permissions.can("update", "sales");

  return (
    <ValidatedForm
      method="post"
      validator={customerPaymentValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {t(msg({ id: "Payment Terms", message: "Payment Terms" }))}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="customerId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer
              name="invoiceCustomerId"
              label={t(
                msg({ id: "Invoice Customer", message: "Invoice Customer" })
              )}
              onChange={(value) => setCustomer(value?.value as string)}
            />
            <CustomerLocation
              name="invoiceCustomerLocationId"
              label={t(
                msg({ id: "Invoice Location", message: "Invoice Location" })
              )}
              customer={customer}
            />
            <CustomerContact
              name="invoiceCustomerContactId"
              label={t(
                msg({ id: "Invoice Contact", message: "Invoice Contact" })
              )}
              customer={customer}
            />

            <PaymentTerm
              name="paymentTermId"
              label={t(msg({ id: "Payment Term", message: "Payment Term" }))}
            />
            <CustomFormFields table="customerPayment" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              {tShared(msg({ id: "Save", message: "Save" }))}
            </Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default CustomerPaymentForm;
