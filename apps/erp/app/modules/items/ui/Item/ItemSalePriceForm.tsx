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
                currency: company?.baseCurrencyCode ?? "USD"
              }}
            />
            {/* <Currency
              name="currencyCode"
              label="Currency"
              onChange={(newValue) => {
                if (newValue) setCurrency(newValue?.value);
              }}
            />

            <UnitOfMeasure
              name="salesUnitOfMeasureCode"
              label="Sales Unit of Measure"
            />

            <Boolean name="salesBlocked" label="Sales Blocked" />
            <Boolean name="priceIncludesTax" label="Price Includes Tax" />
            <Boolean
              name="allowInvoiceDiscount"
              label="Allow Invoice Discount"
            /> */}
            <CustomFormFields table="partUnitSalePrice" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemSalePriceForm;
