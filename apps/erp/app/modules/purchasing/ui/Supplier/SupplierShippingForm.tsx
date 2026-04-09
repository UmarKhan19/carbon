import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  ShippingMethod,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { supplierShippingValidator } from "~/modules/purchasing";

type SupplierShippingFormProps = {
  initialValues: z.infer<typeof supplierShippingValidator>;
};

const SupplierShippingForm = ({ initialValues }: SupplierShippingFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [supplier, setSupplier] = useState<string | undefined>(
    initialValues.shippingSupplierId
  );

  // const shippingTermOptions =
  //   routeData?.shippingTerms?.map((term) => ({
  //     value: term.id,
  //     label: term.name,
  //   })) ?? [];

  const isDisabled = !permissions.can("update", "purchasing");

  return (
    <ValidatedForm
      method="post"
      validator={supplierShippingValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Shipping</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="supplierId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Supplier
              name="shippingSupplierId"
              label={t`Shipping Supplier`}
              onChange={(value) => setSupplier(value?.value as string)}
            />
            <SupplierLocation
              name="shippingSupplierLocationId"
              label={t`Shipping Location`}
              supplier={supplier}
            />
            <SupplierContact
              name="shippingSupplierContactId"
              label={t`Shipping Contact`}
              supplier={supplier}
            />

            <ShippingMethod
              name="shippingMethodId"
              label={t`Shipping Method`}
            />
            {/* <Select
              name="shippingTermId"
              label={t`Shipping Term`}
              options={shippingTermOptions}
            /> */}
            <CustomFormFields table="supplierShipping" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default SupplierShippingForm;
