import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import type { z } from "zod";
import {
  Currency,
  DatePicker,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  priceListPriceTypes,
  priceListStatusTypes,
  priceListValidator
} from "../../pricing.models";

type PriceListFormProps = {
  initialValues: z.infer<typeof priceListValidator>;
  onClose: () => void;
};

const PriceListForm = ({ initialValues, onClose }: PriceListFormProps) => {
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const permissionModule = "sales";
  const isDisabled = isEditing
    ? !permissions.can("update", permissionModule)
    : !permissions.can("create", permissionModule);

  const listPath = path.to.salesPriceLists;

  const action = isEditing
    ? path.to.priceListDetails(initialValues.id!)
    : `${listPath}/new`;

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={priceListValidator}
            method="post"
            action={action}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Price List
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value="Sales" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Input name="description" label="Description" />
                <Currency name="currencyCode" label="Currency" />
                <Select
                  name="priceType"
                  label="Price Type"
                  options={priceListPriceTypes.map((t) => ({
                    label: t,
                    value: t
                  }))}
                />
                {isEditing && (
                  <Select
                    name="status"
                    label="Status"
                    options={priceListStatusTypes.map((s) => ({
                      label: s,
                      value: s
                    }))}
                  />
                )}
                <DatePicker name="validFrom" label="Valid From" />
                <DatePicker name="validTo" label="Valid To" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default PriceListForm;
