import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useRef, useState } from "react";
import { ShelfLifeLabelTypeForm } from "~/modules/items/ui/Item";
import { Enumerable } from "../Enumerable";

type ShelfLifeLabelTypeSelectProps = Omit<ComboboxProps, "options"> & {
  options: { value: string; label: string }[];
};

const ShelfLifeLabelType = ({
  options,
  ...props
}: ShelfLifeLabelTypeSelectProps) => {
  const newModal = useDisclosure();
  const [created, setCreated] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options.map((e) => ({
          value: e.value,
          label: <Enumerable value={e.label} />
        }))}
        {...props}
        label={props.label ?? "Label Type"}
        onCreateOption={(option) => {
          setCreated(option);
          newModal.onOpen();
        }}
      />

      {newModal.isOpen && (
        <ShelfLifeLabelTypeForm
          type="modal"
          initialValues={{ name: created }}
          onClose={() => {
            setCreated("");
            newModal.onClose();
            triggerRef.current?.click();
          }}
        />
      )}
    </>
  );
};

export default ShelfLifeLabelType;
