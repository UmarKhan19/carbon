import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useRef, useState } from "react";
import { CustomerTypeForm } from "~/modules/sales/ui/CustomerTypes";
import { useCustomerTypes } from "./CustomerType";

type CustomerTypesSelectProps = Omit<CreatableMultiSelectProps, "options">;

const CustomerTypes = (props: CustomerTypesSelectProps) => {
  const newCustomerTypeModal = useDisclosure();

  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCustomerTypes();

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options ?? []}
        {...props}
        label={props?.label ?? "Customer Types"}
        onCreateOption={(option) => {
          newCustomerTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newCustomerTypeModal.isOpen && (
        <CustomerTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newCustomerTypeModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created
          }}
        />
      )}
    </>
  );
};

CustomerTypes.displayName = "CustomerTypes";

export default CustomerTypes;
