import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import type { z } from "zod";
import { CustomFormFields, Hidden, Number, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { itemUnitSalePriceValidator } from "../../items.models";

type ItemSalePriceFormProps = {
  initialValues: z.infer<typeof itemUnitSalePriceValidator>;
};

const ItemSalePriceForm = ({ initialValues }: ItemSalePriceFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const isDisabled = !permissions.can("update", "parts");

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemUnitSalePriceValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Sale Price</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number
              name="unitSalePrice"
              label="Unit Sale Price"
              minValue={0}
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
            />
            <CustomFormFields table="partUnitSalePrice" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isDisabled}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemSalePriceForm;
