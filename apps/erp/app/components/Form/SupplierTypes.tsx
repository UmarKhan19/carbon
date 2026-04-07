import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useRef, useState } from "react";
import SupplierTypeForm from "~/modules/purchasing/ui/SupplierTypes/SupplierTypeForm";
import { useSupplierTypes } from "./SupplierType";

type SupplierTypesSelectProps = Omit<CreatableMultiSelectProps, "options">;

const SupplierTypes = (props: SupplierTypesSelectProps) => {
  const newSupplierTypeModal = useDisclosure();

  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useSupplierTypes();

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options ?? []}
        {...props}
        label={props?.label ?? "Supplier Types"}
        onCreateOption={(option) => {
          newSupplierTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newSupplierTypeModal.isOpen && (
        <SupplierTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newSupplierTypeModal.onClose();
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

SupplierTypes.displayName = "SupplierTypes";

export default SupplierTypes;
