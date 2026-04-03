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
  Customer,
  CustomerType,
  Hidden,
  Submit,
  Supplier,
  SupplierType
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { priceListAssignmentValidator } from "../../pricing.models";

type PriceListAssignmentFormProps = {
  initialValues: z.infer<typeof priceListAssignmentValidator>;
  priceListType: string;
  onClose: () => void;
};

const PriceListAssignmentForm = ({
  initialValues,
  priceListType,
  onClose
}: PriceListAssignmentFormProps) => {
  const permissions = usePermissions();
  const permissionModule =
    priceListType === "Purchase" ? "purchasing" : "sales";
  const isDisabled = !permissions.can("create", permissionModule);

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
            validator={priceListAssignmentValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>Add Assignment</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="priceListId" />
              <VStack spacing={4}>
                {priceListType === "Sales" && (
                  <>
                    <p className="text-sm font-medium text-muted-foreground">
                      Assign to a specific customer or a customer type:
                    </p>
                    <Customer
                      name="customerId"
                      label="Customer"
                      placeholder="Select Customer"
                    />
                    <CustomerType
                      name="customerTypeId"
                      label="Customer Type"
                      placeholder="Select Customer Type"
                    />
                  </>
                )}
                {priceListType === "Purchase" && (
                  <>
                    <p className="text-sm font-medium text-muted-foreground">
                      Assign to a specific supplier or a supplier type:
                    </p>
                    <Supplier
                      name="supplierId"
                      label="Supplier"
                      placeholder="Select Supplier"
                    />
                    <SupplierType
                      name="supplierTypeId"
                      label="Supplier Type"
                      placeholder="Select Supplier Type"
                    />
                  </>
                )}
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

export default PriceListAssignmentForm;
