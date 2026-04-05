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
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { customerShippingValidator } from "../../sales.models";

type CustomerShippingFormProps = {
  initialValues: z.infer<typeof customerShippingValidator>;
};

const CustomerShippingForm = ({ initialValues }: CustomerShippingFormProps) => {
  const { _: t } = useLingui();
  const { _: tShared } = useLingui();
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.shippingCustomerId
  );

  // const shippingTermOptions =
  //   routeData?.shippingTerms?.map((term) => ({
  //     value: term.id,
  //     label: term.name,
  //   })) ?? [];

  const isDisabled = !permissions.can("update", "sales");

  return (
    <ValidatedForm
      method="post"
      validator={customerShippingValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {t(msg({ id: "Shipping", message: "Shipping" }))}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="customerId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer
              name="shippingCustomerId"
              label={t(
                msg({ id: "Shipping Customer", message: "Shipping Customer" })
              )}
              onChange={(value) => setCustomer(value?.value as string)}
            />
            <CustomerLocation
              name="shippingCustomerLocationId"
              label={t(
                msg({ id: "Shipping Location", message: "Shipping Location" })
              )}
              customer={customer}
            />
            <CustomerContact
              name="shippingCustomerContactId"
              label={t(
                msg({ id: "Shipping Contact", message: "Shipping Contact" })
              )}
              customer={customer}
            />

            <ShippingMethod
              name="shippingMethodId"
              label={t(
                msg({ id: "Shipping Method", message: "Shipping Method" })
              )}
            />
            {/* <Select
              name="shippingTermId"
              label="Shipping Term"
              options={shippingTermOptions}
            /> */}
            <CustomFormFields table="customerShipping" />
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

export default CustomerShippingForm;
