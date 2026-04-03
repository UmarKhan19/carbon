import { ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ToggleGroup,
  ToggleGroupItem,
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

const toggleItemClass = cn(
  "h-8 flex-1 basis-0 rounded-md px-3 text-sm font-medium",
  "bg-transparent text-muted-foreground",
  "hover:bg-active hover:text-active-foreground",
  "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
  "transition-all duration-150"
);

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
                  <ToggleGroup
                    type="single"
                    value={assigneeMode}
                    onValueChange={(v) => {
                      if (v) setAssigneeMode(v as AssigneeMode);
                    }}
                    className="inline-flex w-full gap-0 rounded-lg border border-border bg-muted p-0.5"
                  >
                    <ToggleGroupItem value="entity" className={toggleItemClass}>
                      {isSales ? "Customer" : "Supplier"}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="type" className={toggleItemClass}>
                      {isSales ? "Customer Type" : "Supplier Type"}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {isSales ? (
                  assigneeMode === "entity" ? (
                    <Customer name="customerId" label="Customer" />
                  ) : (
                    <CustomerType name="customerTypeId" label="Customer Type" />
                  )
                ) : assigneeMode === "entity" ? (
                  <Supplier name="supplierId" label="Supplier" />
                ) : (
                  <SupplierType name="supplierTypeId" label="Supplier Type" />
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
