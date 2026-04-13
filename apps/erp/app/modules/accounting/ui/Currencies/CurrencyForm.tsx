import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { currencyValidator } from "../../accounting.models";

type CurrencyFormProps = {
  initialValues: z.infer<typeof currencyValidator>;
};

const CurrencyForm = ({ initialValues }: CurrencyFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const [decimalPlaces, setDecimalPlaces] = useState(
    initialValues.decimalPlaces ?? 2
  );

  const { company } = useUser();

  const isBaseCurrency = company?.baseCurrencyCode === initialValues.code;
  const exchangeRateHelperText = isBaseCurrency
    ? t`This is the base currency. Exchange rate is always 1.`
    : t`One ${company?.baseCurrencyCode} is equal to how many ${initialValues.code}?`;

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={currencyValidator}
          method="post"
          action={
            isEditing
              ? path.to.currency(initialValues.id!)
              : path.to.newCurrency
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Currency</Trans>
              ) : (
                <Trans>New Currency</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} isReadOnly />
              <Input name="code" label={t`Code`} isReadOnly />
              <Number
                name="decimalPlaces"
                label={t`Decimal Places`}
                minValue={0}
                maxValue={4}
                onChange={setDecimalPlaces}
              />
              <Number
                name="exchangeRate"
                label={t`Exchange Rate`}
                minValue={isBaseCurrency ? 1 : 0}
                maxValue={isBaseCurrency ? 1 : undefined}
                formatOptions={{
                  minimumFractionDigits: decimalPlaces ?? 0
                }}
                helperText={exchangeRateHelperText}
              />

              <CustomFormFields table="currency" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CurrencyForm;
