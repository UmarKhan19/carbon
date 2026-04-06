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
  Tabs,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { useState } from "react";
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

type AssigneeMode = "entity" | "type";

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

  const [assigneeMode, setAssigneeMode] = useState<AssigneeMode>(() => {
    if (initialValues.customerTypeId || initialValues.supplierTypeId)
      return "type";
    return "entity";
  });

  const isSales = priceListType === "Sales";

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
                <div className="space-y-3">
                  <label className="text-sm font-medium">Assign To</label>
                  <Tabs
                    value={assigneeMode}
                    onValueChange={(v) => setAssigneeMode(v as AssigneeMode)}
                  >
                    <TabsList className="grid grid-cols-2 w-full">
                      <TabsTrigger value="entity">
                        {isSales ? "Customer" : "Supplier"}
                      </TabsTrigger>
                      <TabsTrigger value="type">
                        {isSales ? "Customer Type" : "Supplier Type"}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {isSales ? (
                  assigneeMode === "entity" ? (
                    <>
                      <input type="hidden" name="customerTypeId" value="" />
                      <Customer name="customerId" label="Customer" />
                    </>
                  ) : (
                    <>
                      <input type="hidden" name="customerId" value="" />
                      <CustomerType
                        name="customerTypeId"
                        label="Customer Type"
                      />
                    </>
                  )
                ) : assigneeMode === "entity" ? (
                  <>
                    <input type="hidden" name="supplierTypeId" value="" />
                    <Supplier name="supplierId" label="Supplier" />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="supplierId" value="" />
                    <SupplierType name="supplierTypeId" label="Supplier Type" />
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
